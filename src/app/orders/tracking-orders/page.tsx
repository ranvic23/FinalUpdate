"use client";

import { useRouter } from "next/navigation";
import { db } from "@/app/firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDoc,
  doc,
  updateDoc,
  DocumentReference,
  addDoc,
  getDocs,
  where,
  runTransaction,
  Timestamp,
  FieldValue,
  DocumentData,
  setDoc
} from "firebase/firestore";
import Sidebar from "@/app/components/Sidebar";
import { toast } from "react-hot-toast";

// Import size configurations
import { sizeConfigs } from "@/app/constants/sizeConfigs";

// Add the VARIETIES constant at the top level
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
    allowedVarieties?: string[];
    excludedVarieties?: string[];
    boxPrice?: number;
    description: string;
}

interface StockUpdate {
    ref: DocumentReference;
    data: DocumentData & {
        slices: number;
        variety?: string;
        size?: string;
    };
    quantity: number;
    variety?: string;
    size?: string;
    isSize: boolean;
}

interface VarietyCombination {
  varieties: string[];
  quantity: number;
}

interface StockData {
  id: string;
  sizeId: string;
  sizeName: string;
  combinations: VarietyCombination[];
  totalQuantity: number;
  lastUpdated: Date;
}

interface Order {
  id: string;
  userId?: string;
  userDetails?: {
    firstName: string;
    lastName: string;
  };
  orderDetails: {
    pickupTime: string;
    pickupDate: string;
    status: string;
    orderStatus?: string;
    totalAmount: number;
    paymentMethod: string;
    paymentStatus?: string;
    gcashReference?: string;
    createdAt: string;
    updatedAt?: string;
    isScheduled?: boolean;
  };
  items: Array<{
    cartId: string;
    productSize: string;
    productVarieties: string[];
    productQuantity: number;
    productPrice: number;
  }>;
  ref?: DocumentReference;
}

interface TrackingOrder {
  orderId: string;
  userId?: string;
  customerName: string;
  items: Array<{
    productSize: string;
    productVarieties: string[];
    productQuantity: number;
    productPrice: number;
  }>;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  pickupTime: string;
  pickupDate: string;
  totalAmount: number;
  createdAt: FieldValue;
  updatedAt: FieldValue;
  isScheduled: boolean;
  reservedStockIds: string[];
}

import {
  reserveStock,
  updateReservedStock,
  releaseReservedStock,
  SCHEDULED_STATUS_FLOW
} from "@/app/utils/scheduledOrders";

import { updateStockOnOrderStatus, restoreStockOnCancel } from "@/app/inventory/stock-management/page";

// Define status flows
const regularStatusFlow = [
    "Order Confirmed",
    "Preparing Order",
    "Ready for Pickup",
    "Completed"
] as const;

// Define the status types
type RegularStatus = typeof regularStatusFlow[number];
type ScheduledStatus = typeof SCHEDULED_STATUS_FLOW[number];
type OrderStatus = RegularStatus | ScheduledStatus;

// Add this helper function at the top of the file
const getSlicesPerUnit = (size: string): number => {
  switch (size) {
    case 'Big Bilao': return 60;
    case 'Tray': return 48;
    case 'Small': return 30;
    case 'Half Tray': return 24;
    case 'Solo': return 20;
    case '1/4 Slice': return 12;
    default: return 0;
  }
};

type CustomNotification = {
  id: string;
  message: string;
  type: 'success' | 'error';
  createdAt: Date;
};

interface OrderDetails {
  orderId: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  reference?: string;
  gcashScreenshotUrl?: string;
  varieties: string[];
  size: string;
  quantity: number;
  price?: number;
  updatedAt?: string;
  createdAt?: string;
}

// Bilao size types and deduction amounts
type BilaoSize = "small" | "medium" | "large" | "extra large";

const BILAO_DEDUCTION: Record<BilaoSize, number> = {
    "small": 0.5,
    "medium": 1,
    "large": 1.5,
    "extra large": 2
};

export default function TrackingOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<CustomNotification[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus>("Order Confirmed");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showScheduled, setShowScheduled] = useState(false);
  const router = useRouter();

  // Function to fetch user details
  const fetchUserDetails = async (userId: string | undefined) => {
    try {
      if (!userId) {
        return null;
      }

      const userRef = doc(db, "customers", userId);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.name) {
          const nameParts = data.name.split(" ");
          const firstName = nameParts[0];
          const lastName = nameParts.slice(1).join(" ") || "N/A";
          return {
            firstName,
            lastName,
          };
        } else {
          return {
            firstName: data.firstName || "N/A",
            lastName: data.lastName || "N/A",
          };
        }
      }
      return null;
    } catch (error) {
      console.error("Error fetching user details:", error);
      return null;
    }
  };

  // Function to save tracking order to Firestore
  const saveTrackingOrder = async (order: Order) => {
    try {
      // Check if tracking order already exists
      const trackingOrdersRef = collection(db, "tracking_orders");
      const q = query(trackingOrdersRef, where("orderId", "==", order.id));
      const querySnapshot = await getDocs(q);

      // Set initial status
      const initialStatus = order.orderDetails.status || "Order Confirmed";
      let reservedStockIds: string[] = [];

      // Check if it's a scheduled order
      const isScheduled = new Date(order.orderDetails.pickupDate) > new Date();

      // If this is a new order, check stock availability first
      if (!querySnapshot.docs.length) {
        // Check stock availability
        const stockIssues = await checkStockAvailability(order.items);
        
        // Create notifications for stock issues
        if (stockIssues.length > 0) {
          const notificationRef = collection(db, "notifications");
          const notification = {
            message: `Stock Issues Found for Order #${order.id.slice(0, 6)}:\n${stockIssues.join("\n")}`,
            type: "error",
            createdAt: new Date(),
            read: false,
            orderId: order.id
          };
          await addDoc(notificationRef, notification);

          // Add to local notifications state
          setNotifications(prev => [...prev, {
            id: Math.random().toString(),
            message: notification.message,
            type: 'error',
            createdAt: notification.createdAt
          }]);

          // Show toast notification
          toast("Stock issues detected for new order. Check notifications for details.", {
            style: {
              background: '#fff7ed',
              color: '#9a3412',
              border: '1px solid #fdba74'
            }
          });
        }
      }
      
      // If it's a scheduled order and no tracking order exists, reserve the stock
      if (isScheduled && !querySnapshot.docs.length) {
        reservedStockIds = await reserveStock(
          order.id,
          order.items,
          order.orderDetails.pickupDate,
          order.orderDetails.pickupTime
        );
      }

      // Update the original order status if it's a new order
      if (!order.orderDetails.status && !order.orderDetails.orderStatus) {
        await updateDoc(order.ref!, {
          "orderDetails.status": initialStatus,
          "orderDetails.orderStatus": initialStatus,
          "orderDetails.updatedAt": new Date().toISOString(),
          "orderDetails.isScheduled": isScheduled
        });
      }

      if (!querySnapshot.docs.length) {
        // Create new tracking order
        const trackingOrderData = {
        orderId: order.id,
        customerName: order.userDetails ? 
          `${order.userDetails.firstName} ${order.userDetails.lastName}` : 
          "Walk-in Customer",
          items: order.items,
        paymentMethod: order.orderDetails.paymentMethod,
        paymentStatus: order.orderDetails.paymentStatus || "pending",
          orderStatus: initialStatus,
        pickupTime: order.orderDetails.pickupTime,
        pickupDate: order.orderDetails.pickupDate,
        totalAmount: order.orderDetails.totalAmount,
        createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          isScheduled,
          reservedStockIds
        };

        await addDoc(trackingOrdersRef, trackingOrderData);
      }
    } catch (error) {
      console.error("Error saving tracking order:", error);
      throw error;
    }
  };

  // Real-time orders subscription
  useEffect(() => {
    setLoading(true);
    let unsubscribeOrders: () => void;

    const setupSubscriptions = async () => {
      try {
    const ordersRef = collection(db, "orders");
        const ordersQuery = query(
          ordersRef,
          where("orderDetails.paymentStatus", "==", "approved"),
          where("orderDetails.status", "!=", "Pending Verification"),
          orderBy("orderDetails.createdAt", "desc")
        );

        unsubscribeOrders = onSnapshot(ordersQuery, async (snapshot) => {
          try {
            console.log("Received orders snapshot with", snapshot.docs.length, "documents");
            
        const orderList = await Promise.all(
          snapshot.docs.map(async (doc) => {
            const data = doc.data();
                console.log("Processing order:", doc.id, data);
                
                // Initialize status if not present
                if (!data.orderDetails?.status) {
                  const orderRef = doc.ref;
                  const initialStatus = "Order Confirmed";
                  
                  // Check if pickup date is for a future day
                  const orderDate = new Date(data.orderDetails.createdAt);
                  const pickupDate = new Date(data.orderDetails.pickupDate);
                  
                  // Set to start of day for comparison
                  orderDate.setHours(0, 0, 0, 0);
                  pickupDate.setHours(0, 0, 0, 0);
                  
                  const isScheduled = pickupDate.getTime() > orderDate.getTime();
                  
                  await updateDoc(orderRef, {
                    "orderDetails.status": initialStatus,
                    "orderDetails.orderStatus": initialStatus,
                    "orderDetails.updatedAt": new Date().toISOString(),
                    "orderDetails.isScheduled": isScheduled
                  });
                  
                  data.orderDetails = {
                    ...data.orderDetails,
                    status: initialStatus,
                    orderStatus: initialStatus,
                    isScheduled
                  };
                }

            const userDetails = await fetchUserDetails(data.userId);
                const order = {
              id: doc.id,
              ref: doc.ref,
              ...data,
              userDetails,
            } as Order;

                // Save to tracking orders and check stock
                await saveTrackingOrder(order);

                return order;
              })
            );

            console.log("Processed orders:", orderList);
            setOrders(orderList);
            setLoading(false);
          } catch (error) {
            console.error("Error processing orders:", error);
            setLoading(false);
          }
        }, (error) => {
          console.error("Error in orders subscription:", error);
          setLoading(false);
        });

      } catch (error) {
        console.error("Error setting up subscriptions:", error);
        setLoading(false);
      }
    };

    setupSubscriptions();

    return () => {
      if (unsubscribeOrders) unsubscribeOrders();
    };
  }, []);

  // Function to check stock availability and create notifications
  const checkStockAvailability = async (items: Array<{
    productSize: string;
    productVarieties: string[];
    productQuantity: number;
  }>) => {
    const stockIssues: string[] = [];

    try {
        for (const item of items) {
            // Check if this is a fixed-size product (Bibingka)
            if (item.productVarieties.length === 1 && item.productVarieties[0] === "Bibingka") {
                // Check fixed-size stock
                const fixedStocksRef = collection(db, "fixedSizeStocks");
                const fixedStockQuery = query(
                    fixedStocksRef,
                    where("size", "==", item.productSize.toLowerCase())
                );
                const fixedStockSnapshot = await getDocs(fixedStockQuery);
                
                if (fixedStockSnapshot.empty) {
                    stockIssues.push(`Fixed-size stock not found for ${item.productSize} Bibingka`);
                    continue;
                }

                // Calculate total available quantity
                const totalAvailableQuantity = fixedStockSnapshot.docs.reduce((sum, doc) => {
                    const data = doc.data();
                    return sum + (data.quantity || 0);
                }, 0);

                if (totalAvailableQuantity < item.productQuantity) {
                    stockIssues.push(`Insufficient ${item.productSize} Bibingka stock. Available: ${totalAvailableQuantity}, Required: ${item.productQuantity}`);
                }
            } else {
                // For bilao-based products
                // Calculate deduction per variety based on size and number of varieties
                const getDeductionPerVariety = (size: string, varietyCount: number) => {
                  // Special case for 1/4 slice
                  if (size.toLowerCase() === '1/4 slice' || size.toLowerCase() === '1/4') {
                    return 0.25; // Always 0.25 bilao for 1/4 slice
                  }

                  // For other sizes, calculate based on variety count
                  switch (varietyCount) {
                    case 1: return 1.0;    // 1 variety = 1 bilao
                    case 2: return 0.5;    // 2 varieties = 0.5 bilao each
                    case 3: return 0.34;   // 3 varieties ≈ 0.34 bilao each (approximately 1/3)
                    case 4: return 0.25;   // 4 varieties = 0.25 bilao each
                    default: return 0.25;  // Default to 0.25 for any other case
                  }
                };

                const deductionAmount = getDeductionPerVariety(item.productSize, item.productVarieties.length);
                const totalBilaoNeeded = deductionAmount * item.productQuantity;

                // Check each variety's stock
                for (const variety of item.productVarieties) {
                  const varietyStockRef = collection(db, "varietyStocks");
                  const varietyQuery = query(
                    varietyStockRef,
                    where("variety", "==", variety),
                    orderBy("productionDate", "asc")
                  );
                  
                  const varietySnapshot = await getDocs(varietyQuery);
                  
                  if (varietySnapshot.empty) {
                    throw new Error(`Variety stock not found for ${variety}`);
                  }

                  // Calculate total available bilao for this variety
                  const totalAvailableBilao = varietySnapshot.docs.reduce((sum, doc) => {
                    const data = doc.data();
                    return sum + (data.bilao || 0);
                  }, 0);

                  if (totalAvailableBilao < totalBilaoNeeded) {
                    throw new Error(`Insufficient stock for ${variety}. Available: ${totalAvailableBilao.toFixed(2)} bilao, Required: ${totalBilaoNeeded.toFixed(2)} bilao (${item.productVarieties.length} varieties)`);
                  }
                }
            }
        }
    } catch (error) {
        console.error("Error checking stock availability:", error);
        stockIssues.push("Error checking stock availability");
    }

    return stockIssues;
  };

  // Function to handle status updates
  const handleStatusUpdate = async (orderId: string, newStatus: OrderStatus) => {
    try {
      // Set loading only for the specific order being updated
      const orderElement = document.querySelector(`[data-order-id="${orderId}"]`);
      if (orderElement) {
        orderElement.classList.add('opacity-50');
      }

        const orderRef = doc(db, "orders", orderId);
      const orderDoc = await getDoc(orderRef);
        
        if (!orderDoc.exists()) {
          throw new Error("Order not found");
        }

      const orderData = orderDoc.data();
      const currentStatus = orderData.orderDetails.status;

      // Skip stock checks for cancellations
      if (newStatus !== "Cancelled") {
        // Check stock availability before allowing status change
        const stockIssues = await checkStockAvailability(orderData.items);
        
        // If there are stock issues, block the status change
        if (stockIssues.length > 0) {
          toast.error("Cannot update status: Insufficient stock available");
          return;
        }
      }

      // Handle different status updates
        if (newStatus === "Ready for Pickup") {
        try {
          // Process each item in the order
          for (const item of orderData.items) {
            // Check if this is a fixed-size product (Bibingka)
            if (item.productVarieties.length === 1 && item.productVarieties[0] === "Bibingka") {
              // Get fixed size stock
              const fixedStocksRef = collection(db, "fixedSizeStocks");
              const fixedStockQuery = query(
                fixedStocksRef,
                where("size", "==", item.productSize.toLowerCase())
              );
              const fixedStockSnapshot = await getDocs(fixedStockQuery);
              
              if (fixedStockSnapshot.empty) {
                throw new Error(`Fixed-size stock not found for ${item.productSize} Bibingka`);
              }

              // Calculate total available quantity
              const totalAvailableQuantity = fixedStockSnapshot.docs.reduce((sum, doc) => {
                const data = doc.data();
                return sum + (data.quantity || 0);
              }, 0);

              if (totalAvailableQuantity < item.productQuantity) {
                throw new Error(`Insufficient ${item.productSize} Bibingka stock. Available: ${totalAvailableQuantity}, Required: ${item.productQuantity}`);
              }
            } else {
              // For bilao-based products
              // Calculate deduction per variety based on size and number of varieties
              const getDeductionPerVariety = (size: string, varietyCount: number) => {
                // Special case for 1/4 slice
                if (size.toLowerCase() === '1/4 slice' || size.toLowerCase() === '1/4') {
                  return 0.25; // Always 0.25 bilao for 1/4 slice
                }

                // For other sizes, calculate based on variety count
                switch (varietyCount) {
                  case 1: return 1.0;    // 1 variety = 1 bilao
                  case 2: return 0.5;    // 2 varieties = 0.5 bilao each
                  case 3: return 0.34;   // 3 varieties ≈ 0.34 bilao each (approximately 1/3)
                  case 4: return 0.25;   // 4 varieties = 0.25 bilao each
                  default: return 0.25;  // Default to 0.25 for any other case
                }
              };

              const deductionAmount = getDeductionPerVariety(item.productSize, item.productVarieties.length);
              const totalBilaoNeeded = deductionAmount * item.productQuantity;

              // Check each variety's stock
              for (const variety of item.productVarieties) {
                const varietyStockRef = collection(db, "varietyStocks");
                const varietyQuery = query(
                  varietyStockRef,
                  where("variety", "==", variety),
                  orderBy("productionDate", "asc")
                );
                
                const varietySnapshot = await getDocs(varietyQuery);
                
                if (varietySnapshot.empty) {
                  throw new Error(`Variety stock not found for ${variety}`);
                }

                // Calculate total available bilao for this variety
                const totalAvailableBilao = varietySnapshot.docs.reduce((sum, doc) => {
                  const data = doc.data();
                  return sum + (data.bilao || 0);
                }, 0);

                if (totalAvailableBilao < totalBilaoNeeded) {
                  throw new Error(`Insufficient stock for ${variety}. Available: ${totalAvailableBilao.toFixed(2)} bilao, Required: ${totalBilaoNeeded.toFixed(2)} bilao (${item.productVarieties.length} varieties)`);
                }
              }
            }

            // Begin transaction for stock deduction
            await runTransaction(db, async (transaction) => {
              if (item.productVarieties.length === 1 && item.productVarieties[0] === "Bibingka") {
                // Handle fixed-size Bibingka stock deduction
                const fixedStocksRef = collection(db, "fixedSizeStocks");
                const fixedStockQuery = query(
                  fixedStocksRef,
                  where("size", "==", item.productSize.toLowerCase()),
                  orderBy("productionDate", "asc")
                );
                const fixedStockSnapshot = await getDocs(fixedStockQuery);
                let remainingToDeduct = item.productQuantity;

                for (const stockDoc of fixedStockSnapshot.docs) {
                  if (remainingToDeduct <= 0) break;

                  const stockData = stockDoc.data();
                  const currentQuantity = stockData.quantity || 0;
                  const deductAmount = Math.min(remainingToDeduct, currentQuantity);
                  const newQuantity = currentQuantity - deductAmount;

                  const stockRef = stockDoc.ref;
                  transaction.update(stockRef, {
                    quantity: newQuantity,
                    lastUpdated: new Date().toISOString()
                  });

                  // Record stock history
                  const historyCollectionRef = collection(db, "stockHistory");
                  const newHistoryDocRef = doc(historyCollectionRef);
                  transaction.set(newHistoryDocRef, {
                    stockId: stockDoc.id,
                    variety: "Bibingka",
                    type: "out",
                    bilao: 0,
                    previousBilao: 0,
                    newBilao: 0,
                    size: item.productSize.toLowerCase(),
                    quantity: deductAmount,
                    previousQuantity: currentQuantity,
                    newQuantity: newQuantity,
                    date: new Date(),
                    updatedBy: "Order System",
                    remarks: `Order pickup - Order ID: ${orderId} - Deducted ${deductAmount} pieces`,
                    isDeleted: false,
                    productionDate: stockData.productionDate,
                    expiryDate: stockData.expiryDate
                  });

                  remainingToDeduct -= deductAmount;
                }
              } else {
                // Handle bilao-based stock deduction
                const deductionAmount = (() => {
                  // Special case for 1/4 slice
                  if (item.productSize.toLowerCase() === '1/4 slice' || item.productSize.toLowerCase() === '1/4') {
                    return 0.25; // Always 0.25 bilao for 1/4 slice
                  }

                  // For other sizes, calculate based on variety count
                  switch (item.productVarieties.length) {
                    case 1: return 1.0;    // 1 variety = 1 bilao
                    case 2: return 0.5;    // 2 varieties = 0.5 bilao each
                    case 3: return 0.34;   // 3 varieties ≈ 0.34 bilao each
                    case 4: return 0.25;   // 4 varieties = 0.25 bilao each
                    default: return 0.25;  // Default to 0.25 for any other case
                  }
                })();
                const totalBilaoNeeded = deductionAmount * item.productQuantity;

                for (const variety of item.productVarieties) {
                  const varietyStockRef = collection(db, "varietyStocks");
                  const varietyQuery = query(
                    varietyStockRef,
                    where("variety", "==", variety),
                    orderBy("productionDate", "asc")
                  );
                  
                  const varietySnapshot = await getDocs(varietyQuery);
                  let remainingToDeduct = totalBilaoNeeded;

                  for (const stockDoc of varietySnapshot.docs) {
                    if (remainingToDeduct <= 0) break;

                    const stockData = stockDoc.data();
                    const currentBilao = stockData.bilao || 0;
                    const deductAmount = Math.min(remainingToDeduct, currentBilao);
                    const newBilao = currentBilao - deductAmount;

                    const stockRef = stockDoc.ref;
                    transaction.update(stockRef, {
                      bilao: newBilao,
                      lastUpdated: new Date().toISOString()
                    });

                    // Record stock history with more detailed remarks
                    const historyCollectionRef = collection(db, "stockHistory");
                    const newHistoryDocRef = doc(historyCollectionRef);
                    transaction.set(newHistoryDocRef, {
                      stockId: stockDoc.id,
                      variety: variety,
                      type: "out",
                      bilao: deductAmount,
                      previousBilao: currentBilao,
                      newBilao: newBilao,
              date: new Date(),
              updatedBy: "Order System",
                      remarks: `Order pickup - Order ID: ${orderId} - Deducted ${deductAmount.toFixed(2)} bilao (${item.productVarieties.length} varieties in order)`,
                      isDeleted: false,
                      productionDate: stockData.productionDate,
                      expiryDate: stockData.expiryDate
                    });

                    remainingToDeduct -= deductAmount;
                  }
                }
              }

              // Update order status
              transaction.update(orderRef, {
                status: newStatus,
                "orderDetails.status": newStatus,
                "orderDetails.orderStatus": newStatus,
                lastUpdated: new Date().toISOString(),
                "orderDetails.updatedAt": new Date().toISOString()
              });
            });
          }
        } catch (error) {
          console.error("Error processing order:", error);
          throw error;
        }
      } else if (newStatus === "Completed") {
        // For completed orders, update status and sales data
        await updateDoc(orderRef, {
          status: newStatus,
          "orderDetails.status": newStatus,
          "orderDetails.orderStatus": newStatus,
          lastUpdated: new Date().toISOString(),
          "orderDetails.updatedAt": new Date().toISOString()
        });

        // Update sales data
        await updateSalesData(orderData);

        // Release reserved stock if it was a scheduled order
        if (orderData.orderDetails.isScheduled) {
          await releaseReservedStock(orderId, newStatus);
        }
      } else if (newStatus === "Cancelled") {
        // For cancelled orders, restore the stock if it was already deducted
        if (currentStatus === "Ready for Pickup") {
          // Handle each item in the order
          for (const item of orderData.items) {
            // Construct OrderDetails object for each item
            const orderDetails: OrderDetails = {
            orderId: orderId,
              size: item.productSize,
              varieties: item.productVarieties,
              quantity: item.productQuantity
            };
            await restoreStockOnCancel(orderDetails);
          }
        }
        
        // Release reserved stock if it was a scheduled order
        if (orderData.orderDetails.isScheduled) {
          await releaseReservedStock(orderId, newStatus);
        }
        
        await updateDoc(orderRef, {
          status: newStatus,
          "orderDetails.status": newStatus,
          "orderDetails.orderStatus": newStatus,
          lastUpdated: new Date().toISOString(),
          "orderDetails.updatedAt": new Date().toISOString()
        });
      } else {
        // For other status changes
        await updateDoc(orderRef, {
          status: newStatus,
          "orderDetails.status": newStatus,
          "orderDetails.orderStatus": newStatus,
          lastUpdated: new Date().toISOString(),
          "orderDetails.updatedAt": new Date().toISOString()
        });

        // Update reserved stock status if it exists
        if (orderData.orderDetails.isScheduled && orderData.orderDetails.reservedStockIds?.length > 0) {
          await updateReservedStock(orderId, newStatus);
        }
      }

      toast.success("Order status updated successfully");
    } catch (error) {
      console.error("Error updating order status:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update order status");
    } finally {
      // Remove loading state from the specific order
      const orderElement = document.querySelector(`[data-order-id="${orderId}"]`);
      if (orderElement) {
        orderElement.classList.remove('opacity-50');
      }
    }
  };

  // Function to handle inventory deduction
  const handleInventoryDeduction = async (items: any[]) => {
    try {
      await runTransaction(db, async (transaction) => {
        // STEP 1: Perform all reads first
        const stockUpdates: StockUpdate[] = [];
        
        for (const item of items) {
          // Calculate total slices needed for this item
          const sizeConfig = sizeConfigs.find(s => s.name === item.productSize);
          if (!sizeConfig) continue;
          
          const totalSlicesNeeded = sizeConfig.totalSlices * item.productQuantity;
          const slicesPerVariety = totalSlicesNeeded / item.productVarieties.length;

          // Check and update stock for each variety
          for (const variety of item.productVarieties) {
            const varietyStockRef = doc(collection(db, "varietyStocks"), variety);
            const varietyStock = await transaction.get(varietyStockRef);
            
            if (!varietyStock.exists()) {
              throw new Error(`Stock not found for variety: ${variety}`);
            }

            const varietyData = varietyStock.data() as DocumentData & {
              slices: number;
              variety?: string;
            };

            if (varietyData.slices < slicesPerVariety) {
              throw new Error(`Insufficient slices for variety: ${variety}`);
            }

            // Store the update for later
            stockUpdates.push({
              ref: varietyStock.ref,
              data: varietyData,
              quantity: slicesPerVariety,
              variety,
              isSize: false
            });
          }
        }
        
        // STEP 2: Perform all updates
        for (const update of stockUpdates) {
          transaction.update(update.ref, {
            slices: update.data.slices - update.quantity
          });
        }
      });
    } catch (error) {
      console.error("Error deducting inventory:", error);
      throw error;
    }
  };

  // Filter orders based on scheduled status and search term
  const filteredOrders = orders.filter((order) => {
    console.log("Filtering order:", order.id, {
      isScheduled: order.orderDetails.isScheduled,
      showScheduled,
      paymentMethod: order.orderDetails.paymentMethod,
      paymentStatus: order.orderDetails.paymentStatus,
      createdAt: order.orderDetails.createdAt,
      pickupDate: order.orderDetails.pickupDate
    });

    // Only filter GCash payments that need approval
    const paymentValid = 
      order.orderDetails.paymentMethod?.toLowerCase() !== 'gcash' ||
      order.orderDetails.paymentStatus === 'approved';

    // Check if order matches search term
    const matchesSearch =
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.userDetails &&
        `${order.userDetails.firstName} ${order.userDetails.lastName}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase()));

    // Check if order is scheduled based on pickup date
    const orderDate = new Date(order.orderDetails.createdAt);
    const pickupDate = new Date(order.orderDetails.pickupDate);
    
    // Set to start of day for comparison
    orderDate.setHours(0, 0, 0, 0);
    pickupDate.setHours(0, 0, 0, 0);
    
    const isScheduled = pickupDate.getTime() > orderDate.getTime();
    
    // Update the order's isScheduled flag if it doesn't match our calculation
    if (order.orderDetails.isScheduled !== isScheduled && order.ref) {
      updateDoc(order.ref, {
        "orderDetails.isScheduled": isScheduled
      }).catch(error => console.error("Error updating isScheduled flag:", error));
    }

    // Check scheduled status - if showScheduled is true, show scheduled orders, otherwise show non-scheduled
    const matchesScheduled = showScheduled ? isScheduled : !isScheduled;

    return paymentValid && matchesSearch && matchesScheduled;
  });

  // Get available statuses based on current status and order type
  const getAvailableStatuses = (currentStatus: OrderStatus, isScheduled: boolean): OrderStatus[] => {
    if (isScheduled) {
      switch (currentStatus) {
        case "Order Confirmed":
          return ["Stock Reserved", "Preparing Order", "Ready for Pickup", "Completed", "Cancelled"];
        case "Stock Reserved":
          return ["Preparing Order", "Ready for Pickup", "Completed", "Cancelled"];
        case "Preparing Order":
          return ["Ready for Pickup", "Completed", "Cancelled"];
        case "Ready for Pickup":
          return ["Completed", "Cancelled"];
        case "Completed":
        case "Cancelled":
          return [];
        default:
          return ["Order Confirmed", "Stock Reserved", "Preparing Order", "Ready for Pickup", "Completed", "Cancelled"];
      }
    } else {
      switch (currentStatus) {
        case "Order Confirmed":
          return ["Preparing Order", "Ready for Pickup", "Completed", "Cancelled"];
        case "Preparing Order":
          return ["Ready for Pickup", "Completed", "Cancelled"];
        case "Ready for Pickup":
          return ["Completed", "Cancelled"];
        case "Completed":
        case "Cancelled":
          return [];
        default:
          return ["Order Confirmed", "Preparing Order", "Ready for Pickup", "Completed", "Cancelled"];
      }
    }
  };

  const getStatusColor = (status: string | undefined) => {
    if (!status) return "bg-gray-100 text-gray-800";
    switch (status.toLowerCase()) {
      case "order confirmed":
        return "bg-blue-100 text-blue-800";
      case "stock reserved":
        return "bg-indigo-100 text-indigo-800";
      case "preparing order":
        return "bg-yellow-100 text-yellow-800";
      case "ready for pickup":
        return "bg-green-100 text-green-800";
      case "completed":
        return "bg-gray-100 text-gray-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getPaymentMethodBadge = (paymentMethod: string, paymentStatus?: string) => {
    if (paymentMethod === 'GCash') {
      return paymentStatus === 'approved' 
        ? 'bg-green-100 text-green-800' 
        : 'bg-yellow-100 text-yellow-800';
    }
    return 'bg-blue-100 text-blue-800';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Update the updateSalesData function to be more robust
  const updateSalesData = async (orderData: any) => {
    try {
      const salesRef = doc(db, "sales", "summary");
      const salesDoc = await getDoc(salesRef);
      
      // Use current date as completion date when order is marked as completed
      const completionDate = new Date();
      const month = completionDate.getMonth() + 1;
      const year = completionDate.getFullYear();
      const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
      const dayKey = `${year}-${month.toString().padStart(2, '0')}-${completionDate.getDate().toString().padStart(2, '0')}`;
      
      // Ensure we have valid numbers
      const orderAmount = Number(orderData.orderDetails.totalAmount) || 0;
      
      if (!salesDoc.exists()) {
        // Initialize the sales document if it doesn't exist
        await setDoc(salesRef, {
          totalSales: orderAmount,
          monthlySales: { [monthKey]: orderAmount },
          dailySales: { [dayKey]: orderAmount },
          totalOrders: 1,
          monthlyOrders: { [monthKey]: 1 },
          dailyOrders: { [dayKey]: 1 },
          lastUpdated: new Date().toISOString()
        });
      } else {
        const salesData = salesDoc.data();
        // Update sales summary with proper type checking
        await updateDoc(salesRef, {
          totalSales: Number(salesData.totalSales || 0) + orderAmount,
          [`monthlySales.${monthKey}`]: Number(salesData.monthlySales?.[monthKey] || 0) + orderAmount,
          [`dailySales.${dayKey}`]: Number(salesData.dailySales?.[dayKey] || 0) + orderAmount,
          totalOrders: Number(salesData.totalOrders || 0) + 1,
          [`monthlyOrders.${monthKey}`]: Number(salesData.monthlyOrders?.[monthKey] || 0) + 1,
          [`dailyOrders.${dayKey}`]: Number(salesData.dailyOrders?.[dayKey] || 0) + 1,
          lastUpdated: new Date().toISOString()
        });
      }

      console.log('Sales data updated successfully:', {
        orderAmount,
        monthKey,
        dayKey,
        completionDate
      });
    } catch (error) {
      console.error("Error updating sales data:", error);
      throw new Error("Failed to update sales data");
    }
  };

  return (
    <ProtectedRoute>
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-auto">
          <div className="p-4">
            <div className="mb-4 flex justify-between items-center">
              <div className="flex items-center space-x-4">
                <h1 className="text-2xl font-semibold text-gray-900">
                  {showScheduled ? 'Scheduled Orders' : 'Today\'s Orders'}
            </h1>
                <button
                  onClick={() => setShowScheduled(!showScheduled)}
                  className={`px-4 py-2 rounded-lg ${
                    showScheduled
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  {showScheduled ? 'View Today\'s Orders' : 'View Scheduled Orders'}
                </button>
              </div>
              <div className="flex items-center space-x-4">
              <input
                type="text"
                  placeholder="Search orders..."
                  className="px-4 py-2 border rounded-lg"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

            {/* Orders Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Order ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Customer Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Items
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payment Method
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Order Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Pickup Details
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-4">
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                        </div>
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-4">
                        No orders found.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} data-order-id={order.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900">
                            #{order.id.slice(0, 6)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDate(order.orderDetails.createdAt)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {order.userDetails
                              ? `${order.userDetails.firstName} ${order.userDetails.lastName}`.trim()
                              : "Walk-in Customer"}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {order.items.map((item, index) => (
                              <div key={item.cartId} className="mb-2">
                                <div className="font-medium">Size: {item.productSize}</div>
                                <div>Varieties: {item.productVarieties.join(", ")}</div>
                                <div>Quantity: {item.productQuantity}</div>
                                <div>Price: ₱{item.productPrice.toLocaleString()}</div>
                                {index < order.items.length - 1 && <hr className="my-1" />}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPaymentMethodBadge(order.orderDetails.paymentMethod, order.orderDetails.paymentStatus)}`}>
                            {order.orderDetails.paymentMethod}
                            {order.orderDetails.paymentMethod === 'GCash' && order.orderDetails.paymentStatus === 'approved' && ' (Approved)'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <select
                            className={`text-sm border rounded-md px-3 py-1 ${getStatusColor(order.orderDetails.status)}`}
                            onChange={(e) => handleStatusUpdate(order.id, e.target.value as OrderStatus)}
                            value={order.orderDetails.status}
                          >
                            <option value={order.orderDetails.status} disabled>
                              {order.orderDetails.status}
                            </option>
                            {getAvailableStatuses(
                              order.orderDetails.status as OrderStatus,
                              order.orderDetails.isScheduled || false
                            ).map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-gray-900">
                              Date: {new Date(order.orderDetails.pickupDate).toLocaleDateString()}
                            </div>
                            <div className="text-sm text-gray-600">
                              Time: {order.orderDetails.pickupTime}
                            </div>
                            {order.orderDetails.isScheduled && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                Scheduled Order
                              </span>
                            )}
                          <button
                            onClick={() => router.push(`/orders/${order.id}`)}
                              className="mt-2 text-sm text-blue-600 hover:text-blue-900 font-medium block"
                          >
                              View Details →
                          </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
} 