"use client";

import { useRouter } from "next/navigation";
import { db } from "@/app/firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  updateDoc,
  doc,
  onSnapshot,
  getDoc,
  DocumentReference,
  where,
} from "firebase/firestore";
import Sidebar from "@/app/components/Sidebar";

interface Order {
  id: string;
  orderType: string;
  customerName?: string;
  userId?: string;
  userDetails?: {
    firstName: string;
    lastName: string;
  } | null;
  customerDetails?: {
    name: string;
  };
  orderDetails: {
    status: string;
    totalAmount: number;
    createdAt: string;
    pickupDate: string;
    pickupTime: string;
    paymentMethod: string;
    paymentStatus?: string;
    orderType: string;
    gcashReference?: string;
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

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const router = useRouter();

  // Function to fetch user details
  const fetchUserDetails = async (userId: string | undefined) => {
    try {
      // For walk-in orders or orders without userId
      if (!userId) {
        return null;
      }

      const userRef = doc(db, "customers", userId);
      const userDoc = await getDoc(userRef);
      console.log(`Fetching user details for userId: ${userId}`, {
        exists: userDoc.exists(),
        data: userDoc.exists() ? userDoc.data() : null
      });
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        // Check if user has name field (Google sign-in) or firstName/lastName (regular sign-up)
        if (data.name) {
          // For Google sign-in users, split the name into first and last name
          const nameParts = data.name.split(" ");
          const firstName = nameParts[0];
          const lastName = nameParts.slice(1).join(" ") || "";
          return {
            firstName,
            lastName,
          };
        } else {
          // For regular sign-up users
          return {
            firstName: data.firstName || "",
            lastName: data.lastName || ""
          };
        }
      }
      return null;
    } catch (error) {
      console.error("Error fetching user details:", error);
      return null;
    }
  };

  // Real-time orders subscription
  useEffect(() => {
    const ordersRef = collection(db, "orders");
    const q = query(ordersRef, orderBy("orderDetails.createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        try {
          const orderList = await Promise.all(
            snapshot.docs.map(async (doc) => {
              const data = doc.data();
              console.log(`Processing order ${doc.id}:`, data);
              let userDetails = null;

              // Only fetch user details for non-walk-in orders
              if (data.orderType !== "walk-in") {
                userDetails = await fetchUserDetails(data.userId);
                console.log(`User details for order ${doc.id}:`, userDetails);
              } else {
                // For walk-in orders, use customerName
                userDetails = {
                  firstName: data.customerName || "Walk-in",
                  lastName: "Customer"
                };
              }

              return {
                id: doc.id,
                ref: doc.ref,
                ...data,
                userDetails,
              } as Order;
            })
          );
          setOrders(orderList);
        } catch (error) {
          console.error("Error processing orders:", error);
        } finally {
          setLoading(false);
        }
      },
      (error) => {
        console.error("Error fetching orders:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    try {
      const order = orders.find((o) => o.id === orderId);
      if (!order?.ref) {
        console.error("No document reference found for order:", orderId);
        return;
      }

      await updateDoc(order.ref, {
        "orderDetails.status": newStatus,
        "orderDetails.updatedAt": new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error updating order status:", error);
      alert("Failed to update order status.");
    }
  };

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      searchTerm === "" ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.userDetails &&
        `${order.userDetails.firstName} ${order.userDetails.lastName}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase()));

    const matchesPaymentFilter =
      filterPayment === "all" ||
      order.orderDetails.paymentStatus === filterPayment;

    const matchesStatusFilter =
      filterStatus === "all" ||
      order.orderDetails.status === filterStatus;

    const matchesTypeFilter =
      filterType === "all" ||
      (filterType === "walk-in" && order.orderDetails.orderType === "walk-in") ||
      (filterType === "scheduled" && order.orderDetails.orderType === "scheduled") ||
      (filterType === "pickup-now" && order.orderDetails.orderType === "pickup-now") ||
      (filterType === "pending-verification" && order.orderDetails.status === "pending") ||
      (filterType === "completed" && order.orderDetails.status === "completed");

    return matchesSearch && matchesPaymentFilter && matchesStatusFilter && matchesTypeFilter;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (timeString: string | undefined) => {
    if (!timeString) return "N/A";
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
          <h1 className="text-3xl font-bold text-gray-800 mb-6">
            Orders Management
          </h1>

          {/* Filters and Search */}
          <div className="bg-white p-4 rounded-lg shadow-md mb-6 flex flex-wrap gap-4 items-center">
            <input
              type="text"
              placeholder="Search by Order ID or Customer Name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border p-2 rounded flex-1"
            />

            {/* Order Type Filter */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border p-2 rounded"
            >
              <option value="all">All Types</option>
              <option value="walk-in">Walk-in Orders</option>
              <option value="scheduled">Scheduled Pickup</option>
              <option value="pickup-now">Pickup Now</option>
              <option value="pending-verification">Pending Verification</option>
              <option value="completed">Completed Orders</option>
            </select>

            {/* Payment Status Filter */}
            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
              className="border p-2 rounded"
            >
              <option value="all">All Payments</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>

            {/* Order Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border p-2 rounded"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="ready">Ready for Pickup</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
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
                      Pickup Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payment Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
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
                            <div>Date: {formatDate(order.orderDetails.pickupDate)}</div>
                            <div>Time: {formatTime(order.orderDetails.pickupTime)}</div>
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
                                order.orderDetails.status === "Cancelled"
                                  ? "bg-red-100 text-red-800"
                                  : order.orderDetails.paymentStatus === "approved"
                                  ? "bg-green-100 text-green-800"
                                  : order.orderDetails.paymentStatus === "rejected"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}>
                                {order.orderDetails.status === "Cancelled"
                                  ? "cancelled"
                                  : order.orderDetails.paymentStatus || "pending"}
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

          {/* Order Details Modal */}
          {showDetails && selectedOrder && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">Order Details</h2>
                    <button
                      onClick={() => setShowDetails(false)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      ×
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="border-b pb-4">
                      <h3 className="font-medium mb-2">Order Information</h3>
                      <p>Order ID: #{selectedOrder.id.slice(0, 6)}</p>
                      <p>
                        Customer Name:{" "}
                        {selectedOrder.userDetails
                          ? `${selectedOrder.userDetails.firstName} ${selectedOrder.userDetails.lastName}`
                          : "Loading..."}
                      </p>
                      <p>
                        Total Amount: ₱
                        {selectedOrder.orderDetails.totalAmount.toLocaleString()}
                      </p>
                      <p>
                        Created At:{" "}
                        {formatDate(selectedOrder.orderDetails.createdAt)}
                      </p>
                      <p>
                        Status:{" "}
                        {selectedOrder.orderDetails.status}
                      </p>
                    </div>

                    <div className="border-b pb-4">
                      <h3 className="font-medium mb-2">Pickup Information</h3>
                      <p>
                        Date: {formatDate(selectedOrder.orderDetails.pickupDate)}
                      </p>
                      <p>
                        Time: {formatTime(selectedOrder.orderDetails.pickupTime)}
                      </p>
                    </div>

                    <div className="border-b pb-4">
                      <h3 className="font-medium mb-2">Payment Information</h3>
                      <p>
                        Method:{" "}
                        {selectedOrder.orderDetails.paymentMethod.toUpperCase()}
                      </p>
                      <p>
                        Status:{" "}
                        {selectedOrder.orderDetails.paymentStatus || "pending"}
                      </p>
                      {selectedOrder.orderDetails.paymentMethod.toLowerCase() ===
                        "gcash" && (
                        <p>
                          GCash Reference:{" "}
                          {selectedOrder.orderDetails.gcashReference || "N/A"}
                        </p>
                      )}
                    </div>

                    <div className="border-b pb-4">
                      <h3 className="font-medium mb-2">Order Items</h3>
                      {selectedOrder.items.map((item, index) => (
                        <div key={index} className="mb-2">
                          <p>Size: {item.productSize}</p>
                          <p>Varieties: {item.productVarieties.join(", ")}</p>
                          <p>Quantity: {item.productQuantity}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
