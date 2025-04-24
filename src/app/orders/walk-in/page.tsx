"use client";

import { useState, useEffect } from "react";
import { addDoc, collection, getDocs, query, where, serverTimestamp, deleteDoc, orderBy } from "firebase/firestore";
import { db } from "../../firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import Sidebar from "@/app/components/Sidebar";
import { deductStockOnOrder } from "../../inventory/stock-management/page";

const VARIETIES = [
  'Bibingka',
  'Sapin-Sapin',
  'Kutsinta',
  'Kalamay',
  'Cassava'
] as const;

interface SizeConfig {
  id: string;
  name: string;
  price: number;
  maxVarieties: number;
  minVarieties: number;
  totalSlices: number;
  allowedVarieties: readonly string[];
  excludedVarieties?: readonly string[];
}

const sizeConfigs: SizeConfig[] = [
  {
    id: '1',
    name: 'Big Bilao',
    price: 520.00,
    maxVarieties: 4,
    minVarieties: 1,
    totalSlices: 60,
    excludedVarieties: ['Cassava'],
    allowedVarieties: ['Bibingka', 'Sapin-Sapin', 'Kutsinta', 'Kalamay']
  },
  {
    id: '2',
    name: 'Tray',
    price: 420.00,
    maxVarieties: 4,
    minVarieties: 1,
    totalSlices: 48,
    allowedVarieties: VARIETIES
  },
  {
    id: '3',
    name: 'Small',
    price: 280.00,
    maxVarieties: 1,
    minVarieties: 1,
    totalSlices: 30,
    allowedVarieties: ['Bibingka']
  },
  {
    id: '4',
    name: 'Half Tray',
    price: 240.00,
    maxVarieties: 2,
    minVarieties: 1,
    totalSlices: 24,
    allowedVarieties: VARIETIES
  },
  {
    id: '5',
    name: 'Solo',
    price: 200.00,
    maxVarieties: 1,
    minVarieties: 1,
    totalSlices: 20,
    allowedVarieties: ['Bibingka']
  },
  {
    id: '6',
    name: '1/4 Slice',
    price: 140.00,
    maxVarieties: 1,
    minVarieties: 1,
    totalSlices: 12,
    allowedVarieties: VARIETIES
  }
];

interface SelectedProduct {
  id: string;
  size: string;
  varieties: string[];
  selectedVarieties: string[];
  quantity: number;
  price: number;
  stockQuantity: number;
  combinations: Array<{
    varieties: string[];
    quantity: number;
  }>;
}

interface OrderItem {
  cartId: string;
  productSize: string;
  productVarieties: string[];
  productQuantity: number;
  productPrice: number;
}

interface RawOrderItem {
  cartId?: string;
  productSize?: string;
  productVarieties?: unknown;
  productQuantity?: number;
  productPrice?: number;
}

interface WalkInOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
    paymentMethod: string;
  gcashReference?: string | null;
    createdAt: string;
  status: 'completed';
}

interface OrderStep {
  step: number;
  title: string;
  isComplete: boolean;
}

interface BilaoDeduction {
  [key: string]: {
    totalBilao: number;
    maxVarieties: number;
  };
}

const BILAO_SIZES: BilaoDeduction = {
  'Big Bilao': { totalBilao: 1, maxVarieties: 4 },
  'Tray': { totalBilao: 1, maxVarieties: 4 },
  'Half Tray': { totalBilao: 0.5, maxVarieties: 2 }
};

const calculateVarietyDeduction = (size: string, selectedVarieties: string[], quantity: number): { variety: string, deduction: number }[] => {
  const bilaoConfig = BILAO_SIZES[size];
  if (!bilaoConfig) return [];

  const { totalBilao } = bilaoConfig; // totalBilao is 1 for Big Bilao and Tray, 0.5 for Half Tray
  const varietyCount = selectedVarieties.length;

  let deductionPerVariety = 0;

  // Adjust deduction logic for Half Tray
  if (size === 'Half Tray') {
    if (varietyCount === 1) {
      deductionPerVariety = totalBilao; // Deduct 1 whole product if only 1 variety
    } else if (varietyCount === 2) {
      deductionPerVariety = totalBilao / 2; // Deduct 0.50 per variety if 2 varieties
    } else if (varietyCount === 3) {
      deductionPerVariety = totalBilao / 3; // Deduct 0.33 per variety if 3 varieties
    } else if (varietyCount === 4) {
      deductionPerVariety = totalBilao / 4; // Deduct 0.25 per variety if 4 varieties
    }
  } 
  // Adjust deduction logic for 1/4 Slice
  else if (size === '1/4 Slice') {
    if (varietyCount === 1) {
      deductionPerVariety = 0.25; // Deduct 0.25 for 1/4 Slice if only 1 variety
    }
  }

  // Return deduction amount for each variety
  return selectedVarieties.map(variety => ({
    variety,
    deduction: deductionPerVariety * quantity
  }));
};

export default function WalkInOrders() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [customerName, setCustomerName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [gcashReference, setGcashReference] = useState<string>("");
  const [currentOrderId, setCurrentOrderId] = useState<string>("");
  const [walkInOrders, setWalkInOrders] = useState<WalkInOrder[]>([]);
  const [showInvoice, setShowInvoice] = useState(false);
  const [currentInvoice, setCurrentInvoice] = useState<WalkInOrder | null>(null);

  const orderSteps: OrderStep[] = [
    { step: 1, title: "Create Order", isComplete: false },
    { step: 2, title: "Process Payment", isComplete: false },
    { step: 3, title: "Complete Order", isComplete: false }
  ];

  useEffect(() => {
    fetchWalkInOrders();
  }, []);

  const fetchWalkInOrders = async () => {
    try {
      const ordersRef = collection(db, "walkInOrders");
      const q = query(ordersRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const orders = snapshot.docs.map(doc => ({
          id: doc.id,
        ...doc.data()
      })) as WalkInOrder[];
      setWalkInOrders(orders);
    } catch (error) {
      console.error("Error fetching walk-in orders:", error);
    }
  };

  const generateOrderId = () => {
    const now = new Date();
    return `WO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  };

  const handleCreateOrder = async () => {
    if (!customerName.trim()) {
      alert("Please enter customer name");
      return;
    }

    if (selectedProducts.length === 0) {
      alert("Please select at least one product");
      return;
    }

    // Validate product selections
    for (const product of selectedProducts) {
      const sizeConfig = sizeConfigs.find(s => s.name === product.size);
      if (!sizeConfig) {
        alert(`Invalid size configuration for ${product.size}`);
        return;
      }

      if (product.selectedVarieties.length < sizeConfig.minVarieties) {
        alert(`Please select at least ${sizeConfig.minVarieties} variety for ${product.size}`);
        return;
      }
    }

    const orderId = generateOrderId();
    setCurrentOrderId(orderId);
    setCurrentStep(2);
  };

  const handleProcessPayment = async () => {
    if (!currentOrderId) {
      alert("No active order found");
      return;
    }

    if (paymentMethod === "GCash" && !gcashReference) {
      alert("Please enter GCash reference number");
      return;
    }

    setLoading(true);
    try {
      const now = new Date();
      const orderRef = collection(db, "walkInOrders");
      
      const newOrder = {
        orderNumber: currentOrderId,
        customerName: customerName.trim(),
        items: selectedProducts.map(p => ({
          cartId: p.id,
          productSize: p.size,
          productVarieties: p.selectedVarieties,
          productQuantity: p.quantity,
          productPrice: p.price
        })),
        totalAmount,
        paymentMethod,
        gcashReference: paymentMethod === "GCash" ? gcashReference : null,
        createdAt: now.toISOString(),
        status: 'completed' as const
      };

      // Create the order first
      const orderDoc = await addDoc(orderRef, newOrder);

      // Update inventory
      for (const product of selectedProducts) {
        const isFixedSize = product.size.toLowerCase() === 'small' || product.size.toLowerCase() === 'solo';
        
        if (isFixedSize) {
          // Handle fixed size products normally
          await deductStockOnOrder({
            orderId: currentOrderId,
            size: product.size,
            varieties: product.selectedVarieties,
            quantity: product.quantity,
            isFixedSize: true
          });
        } else if (product.size === '1/4 Slice') {
          // Handle 1/4 slice normally (one variety only)
          await deductStockOnOrder({
            orderId: currentOrderId,
            size: product.size,
            varieties: product.selectedVarieties,
            quantity: product.quantity,
            isFixedSize: false
          });
        } else {
          // Handle bilao-based products with proportional deduction
          const deductions = calculateVarietyDeduction(
            product.size,
            product.selectedVarieties,
            product.quantity
          );

          // Apply deductions for each variety
          for (const { variety, deduction } of deductions) {
            await deductStockOnOrder({
              orderId: currentOrderId,
              size: product.size,
              varieties: [variety],
              quantity: deduction,
              isFixedSize: false
            });
          }
        }
      }

      // Create sales record
      const salesRef = collection(db, "sales");
      const saleData = {
        orderId: orderDoc.id,
        orderType: "walk-in",
        customerName: customerName.trim(),
        amount: totalAmount,
        date: now,
        items: selectedProducts.map(item => ({
          productSize: item.size,
          productVariety: item.selectedVarieties.join(", "),
          productQuantity: item.quantity,
          productPrice: item.price
        })),
        paymentMethod,
        status: "completed"
      };
      await addDoc(salesRef, saleData);

      setCurrentInvoice({ id: orderDoc.id, ...newOrder });
      setShowInvoice(true);
      setCurrentStep(3);
      fetchWalkInOrders();

      // Reset form
      setSelectedProducts([]);
      setTotalAmount(0);
      setCustomerName("");
      setPaymentMethod("Cash");
      setGcashReference("");
      setCurrentOrderId("");

    } catch (error) {
      console.error("Error processing order:", error);
      alert("Error processing order. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddProduct = (sizeConfig: SizeConfig) => {
    const selectedProduct: SelectedProduct = {
      id: sizeConfig.id,
      size: sizeConfig.name,
      varieties: Array.from(sizeConfig.allowedVarieties),
      selectedVarieties: [],
      quantity: 1,
      price: sizeConfig.price,
      stockQuantity: 999,
      combinations: []
    };

    setSelectedProducts([...selectedProducts, selectedProduct]);
    setTotalAmount(prev => prev + sizeConfig.price);
  };

  const handleRemoveProduct = (index: number) => {
    const product = selectedProducts[index];
    setSelectedProducts(selectedProducts.filter((_, i) => i !== index));
    setTotalAmount(prev => prev - (product.price * product.quantity));
  };

  const handleQuantityChange = (index: number, newQuantity: number) => {
    if (newQuantity < 1) return;
    
      const updatedProducts = [...selectedProducts];
    const product = updatedProducts[index];
      const oldTotal = product.price * product.quantity;
      const newTotal = product.price * newQuantity;
      
      updatedProducts[index] = {
        ...product,
        quantity: newQuantity
      };
      
      setSelectedProducts(updatedProducts);
      setTotalAmount(prev => prev - oldTotal + newTotal);
  };

  const handleVarietyChange = (index: number, selectedOptions: string[]) => {
    const updatedProducts = [...selectedProducts];
    const product = updatedProducts[index];
    const sizeConfig = sizeConfigs.find(s => s.name === product.size);
    
    if (!sizeConfig) return;

    if (sizeConfig.name === '1/4 Slice' && selectedOptions.length > 1) {
      alert('1/4 Slice can only have 1 variety');
      return;
    }

    // For bilao-based products, ensure proper variety count
    if (BILAO_SIZES[sizeConfig.name]) {
      const { maxVarieties } = BILAO_SIZES[sizeConfig.name];
      if (selectedOptions.length > maxVarieties) {
        alert(`${sizeConfig.name} can only have up to ${maxVarieties} varieties`);
        return;
      }
    }

    if (selectedOptions.length < sizeConfig.minVarieties) {
      alert(`${sizeConfig.name} must have at least ${sizeConfig.minVarieties} variety`);
      return;
    }

    updatedProducts[index] = {
      ...product,
      selectedVarieties: selectedOptions
    };
    setSelectedProducts(updatedProducts);
  };

  const handlePaymentMethodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPaymentMethod(e.target.value);
  };

  const Invoice = ({ order, onClose }: { order: WalkInOrder; onClose: () => void }) => {
    return (
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold">INVOICE</h2>
            <p className="text-gray-600">Order #{order.orderNumber}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="font-semibold">Customer:</p>
              <p>{order.customerName}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold">Date:</p>
              <p>{new Date(order.createdAt).toLocaleDateString()}</p>
              <p>{new Date(order.createdAt).toLocaleTimeString()}</p>
            </div>
          </div>
        </div>

        <table className="w-full mb-6">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="text-left py-2">Item</th>
              <th className="text-center py-2">Quantity</th>
              <th className="text-right py-2">Price</th>
              <th className="text-right py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={index} className="border-b border-gray-200">
                <td className="py-2">
                  {item.productSize}
                  <br />
                  <span className="text-sm text-gray-600">
                    {item.productVarieties.join(", ")}
                  </span>
                </td>
                <td className="text-center py-2">{item.productQuantity}</td>
                <td className="text-right py-2">₱{item.productPrice.toLocaleString()}</td>
                <td className="text-right py-2">
                  ₱{(item.productPrice * item.productQuantity).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t-2 border-gray-300 pt-4">
          <div className="flex justify-between items-center text-xl font-bold">
            <span>Total Amount:</span>
            <span>₱{order.totalAmount.toLocaleString()}</span>
          </div>
          <div className="mt-2 text-gray-600">
            <p>Payment Method: {order.paymentMethod}</p>
            {order.gcashReference && (
              <p>GCash Reference: {order.gcashReference}</p>
            )}
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-gray-600">
          <p>Thank you for your purchase!</p>
          <p>Please keep this invoice for your records.</p>
        </div>
      </div>
    );
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-grow p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-6">Walk-in Orders</h1>
          
          {/* Progress Steps */}
          {!showInvoice && (
            <div className="mb-8">
              <div className="flex justify-between items-center">
                {orderSteps.map((step) => (
                  <div key={step.step} className="flex-1">
                    <div className={`relative flex items-center ${
                      currentStep === step.step ? 'text-blue-600' :
                      currentStep > step.step ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                        currentStep === step.step ? 'border-blue-600 bg-blue-50' :
                        currentStep > step.step ? 'border-green-600 bg-green-50' : 'border-gray-300'
                      }`}>
                        {currentStep > step.step ? '✓' : step.step}
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium">{step.title}</p>
                      </div>
                      {step.step < orderSteps.length && (
                        <div className={`flex-1 border-t-2 ${
                          currentStep > step.step ? 'border-green-600' : 'border-gray-300'
                        }`} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invoice View */}
          {showInvoice && currentInvoice && (
            <div className="mb-6">
              <Invoice order={currentInvoice} onClose={() => setShowInvoice(false)} />
            </div>
          )}

          {/* Main Content */}
          {!showInvoice && (
            <>
              {/* Step 1: Create Order */}
              {currentStep === 1 && (
          <div className="bg-white p-6 rounded-lg shadow-md mb-6">
            <h2 className="text-xl font-semibold mb-4">Create New Order</h2>
                  
                  {/* Customer Information */}
                  <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700">Customer Name</label>
                <input
                  type="text"
                  value={customerName}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '' || /^[A-Za-z\s\-'.]+$/.test(value)) {
                          setCustomerName(value);
                        }
                      }}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      placeholder="Enter customer name"
                  required
                />
              </div>

                  {/* Product Selection Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                    {sizeConfigs.map((size) => (
                      <div
                        key={size.id}
                        className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => handleAddProduct(size)}
                      >
                        <h3 className="text-lg font-medium text-gray-900">{size.name}</h3>
                        <p className="text-sm text-gray-500">Slices: {size.totalSlices}</p>
                        <p className="text-sm text-gray-500">
                          Varieties: {size.minVarieties}-{size.maxVarieties}
                        </p>
                        <p className="mt-2 text-lg font-semibold text-blue-600">₱{size.price.toLocaleString()}</p>
                              </div>
                            ))}
              </div>

                  {/* Selected Products */}
                  <div className="space-y-4">
                  {selectedProducts.map((product, index) => (
                      <div key={index} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-medium">{product.size}</h4>
                            <p className="text-sm text-gray-600">₱{product.price.toLocaleString()}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveProduct(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                            Remove
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                          {/* Variety Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Select Varieties
                          </label>
                            <div className="space-y-2">
                              {product.varieties.map((variety) => (
                                <label key={variety} className="flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={product.selectedVarieties.includes(variety)}
                                    onChange={(e) => {
                                      const newSelected = e.target.checked
                                        ? [...product.selectedVarieties, variety]
                                        : product.selectedVarieties.filter(v => v !== variety);
                                      handleVarietyChange(index, newSelected);
                                    }}
                                    className="rounded border-gray-300 text-blue-600"
                                  />
                                  <span className="ml-2 text-sm">{variety}</span>
                                </label>
                              ))}
                            </div>
                        </div>
                        
                          {/* Quantity Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Quantity
                            </label>
                            <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handleQuantityChange(index, product.quantity - 1)}
                                className="px-3 py-1 border rounded-md"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              value={product.quantity}
                                onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                              min="1"
                                className="w-20 text-center border rounded-md"
                            />
                            <button
                              onClick={() => handleQuantityChange(index, product.quantity + 1)}
                                className="px-3 py-1 border rounded-md"
                            >
                              +
                            </button>
                            </div>
                        </div>
                      </div>
                      
                        <div className="mt-2 text-right">
                        Subtotal: ₱{(product.price * product.quantity).toLocaleString()}
                      </div>
                    </div>
                  ))}
              </div>

                  <div className="mt-6">
                    <div className="text-xl font-semibold mb-4">
                Total Amount: ₱{totalAmount.toLocaleString()}
              </div>
              <button
                      onClick={handleCreateOrder}
                disabled={loading || selectedProducts.length === 0}
                      className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                      Create Order
              </button>
                  </div>
                </div>
              )}

              {/* Step 2: Process Payment */}
              {currentStep === 2 && (
                <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                  <h2 className="text-xl font-semibold mb-4">Process Payment</h2>
                  <div className="space-y-4">
                    <div>
                      <p className="text-lg">Order #: {currentOrderId}</p>
                      <p className="text-lg">Total Amount: ₱{totalAmount.toLocaleString()}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Payment Method</label>
                      <select
                        value={paymentMethod}
                        onChange={handlePaymentMethodChange}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="Cash">Cash</option>
                        <option value="GCash">GCash</option>
                      </select>
          </div>

                    {paymentMethod === "GCash" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">GCash Reference Number</label>
                        <input
                          type="text"
                          value={gcashReference}
                          onChange={(e) => setGcashReference(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                          placeholder="Enter GCash reference number"
                          required
                        />
                      </div>
                    )}

                    <button
                      onClick={handleProcessPayment}
                      disabled={loading}
                      className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      Process Payment
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Recent Walk-in Orders */}
          <div className="bg-white p-6 rounded-lg shadow-md mt-8">
            <h2 className="text-xl font-semibold mb-4">Recent Walk-in Orders</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {walkInOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {order.orderNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.customerName}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {order.items.map((item, index) => (
                          <div key={index} className="mb-1">
                            {item.productSize} - {item.productQuantity}x
                              <span className="text-gray-400 text-xs ml-1">
                                ({item.productVarieties.join(", ")})
                              </span>
                          </div>
                        ))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ₱{order.totalAmount.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.paymentMethod}
                        {order.gcashReference && (
                          <div className="text-xs text-gray-400">
                            Ref: {order.gcashReference}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(order.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <button
                          onClick={() => {
                            setCurrentInvoice(order);
                            setShowInvoice(true);
                          }}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          View Invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
} 

function updateSalesDashboard(currentOrderId: string) {
  throw new Error("Function not implemented.");
}
