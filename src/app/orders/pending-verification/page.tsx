"use client";

import { useState, useEffect } from "react";
import {
  collection,
  query,
  orderBy,
  updateDoc,
  doc,
  getDoc,
  where,
  onSnapshot,
  addDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "@/app/firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import Sidebar from "@/app/components/Sidebar";
import { releaseReservedStock } from "@/app/utils/scheduledOrders";

interface OrderItem {
  productSize: string;
  productVarieties: string[];
  productQuantity: number;
  productPrice: number;
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
    totalAmount: number;
    paymentMethod: string;
    paymentStatus?: string;
    gcashReference?: string;
    gcashScreenshotUrl?: string;
    createdAt: string;
  };
  items: OrderItem[];
}

export default function PendingVerificationPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Function to fetch user details
  const fetchUserDetails = async (userId: string | undefined) => {
    try {
      if (!userId) {
        return {
          firstName: "Walk-in",
          lastName: "Customer"
        };
      }

      const userRef = doc(db, "customers", userId);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.name) {
          const nameParts = data.name.split(" ");
          const firstName = nameParts[0];
          const lastName = nameParts.slice(1).join(" ") || "";
          return {
            firstName,
            lastName,
          };
        } else {
          return {
            firstName: data.firstName || "N/A",
            lastName: data.lastName || ""
          };
        }
      }
      return {
        firstName: "Unknown",
        lastName: "Customer"
      };
    } catch (error) {
      console.error("Error fetching user details:", error);
      return {
        firstName: "Unknown",
        lastName: "Customer"
      };
    }
  };

  // Function to update payment status
  const updatePaymentStatus = async (orderId: string, newStatus: string) => {
    try {
      const orderRef = doc(db, "orders", orderId);
      const orderDoc = await getDoc(orderRef);
      if (!orderDoc.exists()) {
        console.error(`Order ${orderId} not found for payment update`);
        setError("Order not found. Please try again.");
        return;
      }
      
      const orderData = orderDoc.data();
      console.log(`Updating payment status for order ${orderId} to ${newStatus}`, orderData);
      
      // When approving payment, update order status and create sales record
      if (newStatus === "approved") {
        // Update order status
        await updateDoc(orderRef, {
          "orderDetails.paymentStatus": newStatus,
          "orderDetails.status": "Order Confirmed",
          "orderDetails.updatedAt": new Date().toISOString(),
        });
        console.log(`Order ${orderId} successfully updated to approved status`);

        // Create sales record
        const salesRef = collection(db, "sales");
        const saleData = {
          orderId: orderId,
          orderType: orderData?.orderType || "walk-in",
          customerName: orderData?.customerName || "Walk-in Customer",
          amount: orderData?.orderDetails?.totalAmount || 0,
          date: new Date(),
          items: (orderData?.items as OrderItem[] || []).map(item => ({
            productSize: item.productSize,
            productVariety: item.productVarieties.join(", "),
            productQuantity: item.productQuantity,
            productPrice: item.productPrice
          })),
          paymentMethod: orderData?.orderDetails?.paymentMethod || "Cash",
          status: "approved"
        };
        await addDoc(salesRef, saleData);
        console.log(`Sales record created for order ${orderId}`);

        setOrders((prevOrders) =>
          prevOrders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  orderDetails: {
                    ...o.orderDetails,
                    paymentStatus: newStatus,
                    status: "Order Confirmed",
                  },
                }
              : o
          )
        );
      } else {
        // For rejection, update both payment status and order status to cancelled
      await updateDoc(orderRef, {
        "orderDetails.paymentStatus": newStatus,
          "orderDetails.status": "Cancelled",
        "orderDetails.updatedAt": new Date().toISOString(),
      });
      console.log(`Order ${orderId} successfully updated to rejected/cancelled status`);

        // If it's a scheduled order, release any reserved stock
        if (orderData?.orderDetails?.isScheduled) {
          await releaseReservedStock(orderId, "Cancelled");
          console.log(`Reserved stock released for scheduled order ${orderId}`);
        }

      setOrders((prevOrders) =>
        prevOrders.map((o) =>
          o.id === orderId
            ? {
                ...o,
                orderDetails: {
                  ...o.orderDetails,
                  paymentStatus: newStatus,
                    status: "Cancelled",
                },
              }
            : o
        )
      );
      }
    } catch (err) {
      console.error("Error updating payment status:", err);
      setError("Failed to update payment status. Please try again.");
    }
  };

  // Fetch orders from Firestore
  useEffect(() => {
    const ordersRef = collection(db, "orders");
    console.log("Setting up orders query for GCash payment verification");

    // Debug function to check all orders
    const checkAllOrders = async () => {
      try {
        console.log("Checking ALL orders in the database...");
        const allOrdersQuery = query(ordersRef, orderBy("orderDetails.createdAt", "desc"));
        const allOrdersSnapshot = await getDocs(allOrdersQuery);
        
        console.log(`Total orders found: ${allOrdersSnapshot.size}`);
        
        // Count orders by type
        let gcashCount = 0;
        let gcashPendingCount = 0;
        let cashCount = 0;
        
        allOrdersSnapshot.forEach(doc => {
          const data = doc.data();
          const paymentMethod = data.orderDetails?.paymentMethod;
          const paymentStatus = data.orderDetails?.paymentStatus;
          
          if (paymentMethod === "GCash") {
            gcashCount++;
            if (paymentStatus === "pending") {
              gcashPendingCount++;
              console.log(`Found pending GCash order: ${doc.id}`, {
                paymentMethod,
                paymentStatus,
                status: data.orderDetails?.status,
                createdAt: data.orderDetails?.createdAt,
                nested: {
                  orderDetails: data.orderDetails
                }
              });
            }
          } else if (paymentMethod === "Cash" || paymentMethod === "cash") {
            cashCount++;
          }
        });
        
        console.log("Order counts:", {
          total: allOrdersSnapshot.size,
          gcash: gcashCount,
          gcashPending: gcashPendingCount,
          cash: cashCount
        });
      } catch (error) {
        console.error("Error checking all orders:", error);
      }
    };
    
    // Run the debug function
    checkAllOrders();

    try {
      // Query for GCash payments that need verification - more flexible query
      const q = query(
        ordersRef,
        where("orderDetails.paymentMethod", "in", ["GCash", "gcash", "GCASH"]),  // Check case variations
        orderBy("orderDetails.createdAt", "desc")
      );

      console.log("Query setup complete, attempting to fetch documents...");

      const unsubscribe = onSnapshot(
        q,
        async (querySnapshot) => {
          console.log("Received orders snapshot with", querySnapshot.size, "documents");
          
          // Debug each document in the snapshot
          querySnapshot.docs.forEach(doc => {
            const data = doc.data();
            console.log(`Document ${doc.id}:`, {
              paymentMethod: data.orderDetails?.paymentMethod,
              paymentStatus: data.orderDetails?.paymentStatus,
              status: data.orderDetails?.status,
              createdAt: data.orderDetails?.createdAt
            });
          });
          
          const ordersList = await Promise.all(
            querySnapshot.docs.map(async (doc) => {
              const data = doc.data();
              
              // Skip orders that don't need verification (already approved/rejected or not pending)
              const paymentStatus = data.orderDetails?.paymentStatus;
              if (paymentStatus !== "pending" && paymentStatus !== undefined) {
                console.log(`Skipping order ${doc.id} - payment status is ${paymentStatus}`);
                return null;
              }
              
              // Log each order's details for debugging
              console.log("Processing GCash order for verification:", doc.id, {
                orderType: data.orderType,
                paymentMethod: data.orderDetails?.paymentMethod,
                paymentStatus: data.orderDetails?.paymentStatus,
                status: data.orderDetails?.status,
                customerName: data.customerName,
                userId: data.userId
              });

              let userDetails = null;
              // For walk-in orders
              if (data.orderType === "walk-in") {
                userDetails = {
                  firstName: data.customerName || "Walk-in",
                  lastName: "Customer"
                };
              }
              // For online orders with userDetails
              else if (data.userDetails?.firstName && data.userDetails?.lastName) {
                userDetails = {
                  firstName: data.userDetails.firstName,
                  lastName: data.userDetails.lastName
                };
              }
              // For online orders with customerDetails
              else if (data.customerDetails?.name) {
                const nameParts = data.customerDetails.name.split(" ");
                userDetails = {
                  firstName: nameParts[0],
                  lastName: nameParts.slice(1).join(" ") || ""
                };
              }
              // Fetch from customers collection as fallback
              else if (data.userId) {
                userDetails = await fetchUserDetails(data.userId);
              }
              // Default fallback
              else {
                userDetails = {
                  firstName: "Unknown",
                  lastName: "Customer"
                };
              }

              return {
                id: doc.id,
                userId: data.userId,
                orderType: data.orderType || "walk-in",
                orderDetails: {
                  ...data.orderDetails,
                  paymentMethod: data.orderDetails?.paymentMethod || "GCash",
                  paymentStatus: data.orderDetails?.paymentStatus || "pending",
                  status: data.orderDetails?.status || "Pending",
                  totalAmount: data.orderDetails?.totalAmount || 0,
                  gcashReference: data.orderDetails?.gcashReference || "N/A",
                  gcashScreenshotUrl: data.orderDetails?.gcashScreenshotUrl || null,
                  createdAt: data.orderDetails?.createdAt || new Date().toISOString(),
                  pickupDate: data.orderDetails?.pickupDate || new Date().toISOString(),
                  pickupTime: data.orderDetails?.pickupTime || new Date().toLocaleTimeString()
                },
                items: data.items || [],
                userDetails,
              } as Order;
            })
          );

          console.log("Processed GCash orders:", ordersList);
          // Filter out null values (orders that don't need verification)
          const filteredOrders = ordersList.filter(order => order !== null) as Order[];
          console.log(`Filtered down to ${filteredOrders.length} orders that need verification`);
          setOrders(filteredOrders);
          setIsLoading(false);
          setError(null);
        },
        (error) => {
          console.error("Error in GCash orders listener:", error);
          setError("Failed to load GCash orders. Please try again later.");
          setIsLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (error) {
      console.error("Error setting up query:", error);
      setError("Failed to set up query for orders. Please try again later.");
      setIsLoading(false);
      return () => {}; // Return empty function as cleanup
    }
  }, []);

  // Filter orders based on search term
  const filteredOrders = orders.filter((order) => {
    const searchString = searchTerm.toLowerCase();
    return (
      order.id.toLowerCase().includes(searchString) ||
      (order.userDetails &&
        `${order.userDetails.firstName} ${order.userDetails.lastName}`
          .toLowerCase()
          .includes(searchString))
    );
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Image modal component
  const ImageModal = ({ imageUrl, onClose }: { imageUrl: string; onClose: () => void }) => {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="relative bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-lg">
          <div className="flex justify-between items-center p-4 border-b">
            <h3 className="font-medium text-gray-900">Payment Screenshot</h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4 bg-gray-50">
            <img 
              src={imageUrl} 
              alt="GCash Payment Screenshot" 
              className="w-full h-auto max-h-[70vh] object-contain mx-auto"
            />
          </div>
          <div className="flex justify-end p-4 border-t">
            <button
              type="button"
              className="px-4 py-2 bg-gray-200 text-gray-800 font-medium rounded hover:bg-gray-300"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 p-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-6">Payment Verification</h1>
          
          {error && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          {selectedImage && (
            <ImageModal 
              imageUrl={selectedImage} 
              onClose={() => setSelectedImage(null)} 
            />
          )}

          <div className="bg-white p-4 rounded-lg shadow-md mb-6">
            <input
              type="text"
              placeholder="Search by Order ID or Customer Name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border p-2 rounded"
            />
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500"></div>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No pending verifications found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Order ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Order Items
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Payment Details
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">
                            #{order.id.slice(0, 6)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {order.userDetails
                              ? `${order.userDetails.firstName} ${order.userDetails.lastName}`.trim()
                              : "Walk-in Customer"}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-600 space-y-1">
                            {order.items.map((item, index) => (
                              <div key={index}>
                                • {item.productQuantity}x {item.productSize} - {item.productVarieties.join(", ")}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {formatDate(order.orderDetails.createdAt)}
                          </div>
                          <div className="text-xs text-gray-500">
                            Pickup: {formatDate(order.orderDetails.pickupDate)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            ₱{order.orderDetails.totalAmount.toLocaleString()}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            Method: {order.orderDetails.paymentMethod}
                          </div>
                          <div className="text-sm text-gray-500">
                            Ref: {order.orderDetails.gcashReference || "N/A"}
                          </div>
                          {order.orderDetails.paymentMethod.toLowerCase() === "gcash" && 
                           order.orderDetails.gcashReference === "SCREENSHOT_UPLOADED" &&
                           order.orderDetails.gcashScreenshotUrl && (
                            <button
                              onClick={() => setSelectedImage(order.orderDetails.gcashScreenshotUrl || null)}
                              className="mt-1 text-blue-600 hover:text-blue-800 text-sm"
                            >
                              View Screenshot
                            </button>
                          )}
                          <div className="mt-1">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              order.orderDetails.paymentStatus === "approved"
                                ? "bg-green-100 text-green-800"
                                : order.orderDetails.paymentStatus === "rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}>
                              {order.orderDetails.paymentStatus}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {order.orderDetails.paymentStatus === "pending" && (
                            <div className="flex flex-col space-y-2">
                              <button
                                onClick={() => updatePaymentStatus(order.id, "approved")}
                                className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-white bg-green-600 hover:bg-green-700"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updatePaymentStatus(order.id, "rejected")}
                                className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-white bg-red-600 hover:bg-red-700"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
