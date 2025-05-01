"use client";

import { useState, useEffect } from "react";
import { db } from "../../firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  runTransaction,
  doc,
  Timestamp
} from "firebase/firestore";
import Sidebar from "@/app/components/Sidebar";
import { useRouter } from "next/navigation";

interface Order {
  id: string;
  userId: string;
  userDetails?: {
    firstName: string;
    lastName: string;
  };
  orderDetails: {
    pickupTime: string;
    pickupDate: string;
    status: string;
    totalAmount: number;
    paymentMethod: string;
    paymentStatus?: string;
    gcashReference?: string;
    createdAt: string;
    updatedAt?: string;
  };
  items: Array<{
    cartId: string;
    productSize: string;
    productVarieties: string[];
    productQuantity: number;
    productPrice: number;
  }>;
  orderType?: string;
  customerName?: string;
  customerDetails?: {
    name: string;
  };
}

export default function PickupNow() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetchPickupNowOrders();
  }, []);

  const fetchPickupNowOrders = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const ordersRef = collection(db, "orders");
      const q = query(
        ordersRef,
        where("orderDetails.status", "in", ["pending", "processing"]),
        orderBy("orderDetails.pickupDate", "asc")
      );

      const snapshot = await getDocs(q);
      const ordersList = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Order[];

      // Filter orders with today's pickup date
      const todayOrders = ordersList.filter(order => {
        const pickupDate = new Date(order.orderDetails.pickupDate);
        return pickupDate >= today && pickupDate < tomorrow;
      });

      setOrders(todayOrders);
    } catch (error) {
      console.error("Error fetching pickup now orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    try {
      // Start a transaction
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, "orders", orderId);
        const orderDoc = await transaction.get(orderRef);
        
        if (!orderDoc.exists()) {
          throw new Error("Order not found");
        }

        const order = orderDoc.data() as Order;

        // If the new status is "Ready for Pickup", reduce stock
        if (newStatus === "Ready for Pickup") {
          // For each item in the order
          for (const item of order.items) {
            // Find the matching stock by size and varieties
            const stocksRef = collection(db, "stocks");
            const stockQuery = query(
              stocksRef,
              where("sizeName", "==", item.productSize),
              where("varieties", "array-contains-any", item.productVarieties)
            );
            
            const stockSnapshot = await getDocs(stockQuery);
            
            if (stockSnapshot.empty) {
              throw new Error(`No stock found for ${item.productSize} with varieties ${item.productVarieties.join(", ")}`);
            }

            // Get the first matching stock
            const stockDoc = stockSnapshot.docs[0];
            const stockData = stockDoc.data();

            // Check if there's enough stock
            if (stockData.quantity < item.productQuantity) {
              throw new Error(`Insufficient stock for ${item.productSize} with varieties ${item.productVarieties.join(", ")}`);
            }

            // Update the stock quantity
            const newQuantity = stockData.quantity - item.productQuantity;
            
            // Update stock document
            transaction.update(stockDoc.ref, {
              quantity: newQuantity,
              lastUpdated: new Date()
            });

            // Add stock history entry
            const historyRef = doc(collection(db, "stockHistory"));
            transaction.set(historyRef, {
              varieties: item.productVarieties,
              sizeName: item.productSize,
              type: 'out',
              quantity: item.productQuantity,
              previousStock: stockData.quantity,
              currentStock: newQuantity,
              date: new Date(),
              updatedBy: "System",
              remarks: `Order ${orderId} ready for pickup`,
              stockId: stockDoc.id,
              isDeleted: false
            });
          }
        }
        
        // If the new status is "Completed", update sales data
        if (newStatus === "Completed") {
          // Add to sales collection
          const salesRef = doc(collection(db, "sales"));
          transaction.set(salesRef, {
            orderId: orderId,
            amount: order.orderDetails.totalAmount,
            date: Timestamp.fromDate(new Date()),
            items: order.items.map(item => ({
              size: item.productSize,
              varieties: item.productVarieties,
              quantity: item.productQuantity,
              price: item.productPrice,
              subtotal: item.productQuantity * item.productPrice
            })),
            paymentMethod: order.orderDetails.paymentMethod,
            customerName: order.userDetails ? `${order.userDetails.firstName} ${order.userDetails.lastName}` : 'Unknown'
          });
        }

        // Update order status
        transaction.update(orderRef, {
          "orderDetails.status": newStatus,
          "orderDetails.updatedAt": new Date().toISOString(),
          ...(newStatus === "Completed" ? {
            "orderDetails.completedAt": new Date().toISOString()
          } : {})
        });
      });

      // Refresh orders list
      fetchPickupNowOrders();
      
      alert(`Order status updated to ${newStatus}`);
    } catch (error) {
      console.error("Error updating order status:", error);
      alert(error instanceof Error ? error.message : "Failed to update order status");
    }
  };

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.userDetails &&
        `${order.userDetails.firstName} ${order.userDetails.lastName}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase()));
    return matchesSearch;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (timeString: string) => {
    try {
      if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9] (AM|PM)$/.test(timeString)) {
        return timeString;
      }
      if (timeString.includes("T")) {
        const date = new Date(timeString);
        return date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      }
      return timeString;
    } catch (error) {
      console.error("Error formatting time:", error);
      return timeString;
    }
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-grow p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-6">Pickup Now Orders</h1>

          {/* Search and Filters */}
          <div className="bg-white p-4 rounded-lg shadow-md mb-6">
            <input
              type="text"
              placeholder="Search by Order ID or Customer Name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Orders Table */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
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
                      Pickup Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payment
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="text-center py-4">
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                        </div>
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-4">
                        No pickup now orders found.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50">
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
                            {(() => {
                              console.log(`Rendering customer name for order ${order.id}:`, {
                                orderType: order.orderType,
                                customerName: order.customerName,
                                userDetails: order.userDetails,
                                customerDetails: order.customerDetails
                              });
                              
                              if (order.orderType === "walk-in") {
                                return order.customerName || "Walk-in Customer";
                              } else if (order.userDetails?.firstName || order.userDetails?.lastName) {
                                return `${order.userDetails.firstName || ""} ${order.userDetails.lastName || ""}`.trim() || "Unknown Customer";
                              } else if (order.customerDetails?.name) {
                                return order.customerDetails.name;
                              } else if (order.customerName) {
                                return order.customerName;
                              } else {
                                return "Unknown Customer";
                              }
                            })()}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {order.items.map((item, index) => (
                              <div key={item.cartId} className="mb-2">
                                <div className="font-medium">Size: {item.productSize}</div>
                                <div>Varieties: {item.productVarieties.join(", ")}</div>
                                <div>Quantity: {item.productQuantity}</div>
                                {index < order.items.length - 1 && <hr className="my-1" />}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {formatTime(order.orderDetails.pickupTime)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            <div className="mb-1">
                              <span className="px-2 py-1 text-sm text-blue-800 bg-blue-100 rounded-full">
                                {order.orderDetails.paymentMethod}
                              </span>
                            </div>
                            <div>
                              <span className={`px-2 py-1 text-sm rounded-full ${
                                order.orderDetails.paymentStatus === "approved"
                                  ? "bg-green-100 text-green-800"
                                  : order.orderDetails.paymentStatus === "rejected"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}>
                                {order.orderDetails.paymentStatus || "pending"}
                              </span>
                            </div>
                            {order.orderDetails.gcashReference && (
                              <div className="text-xs text-gray-500 mt-1">
                                Ref: {order.orderDetails.gcashReference}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <select
                            value={order.orderDetails.status}
                            onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                            className={`px-2 py-1 rounded text-sm ${
                              order.orderDetails.status === "pending"
                                ? "bg-yellow-100 text-yellow-800"
                                : order.orderDetails.status === "processing"
                                ? "bg-blue-100 text-blue-800"
                                : order.orderDetails.status === "ready"
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            <option value="pending">Pending</option>
                            <option value="processing">Processing</option>
                            <option value="ready">Ready for Pickup</option>
                            <option value="completed">Completed</option>
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => router.push(`/orders/${order.id}`)}
                            className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                          >
                            View Details
                          </button>
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