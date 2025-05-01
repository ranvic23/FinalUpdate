"use client";

import { useRouter } from "next/navigation";
import { db } from "@/app/firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDoc,
  doc,
} from "firebase/firestore";
import Sidebar from "@/app/components/Sidebar";

interface Order {
  id: string;
  userId: string;
  userDetails?: {
    firstName: string;
    lastName: string;
  };
  orderDetails: {
    status: string;
    paymentMethod: string;
    createdAt: string;
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

export default function CompletedOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const router = useRouter();

  // Function to fetch user details
  const fetchUserDetails = async (userId: string) => {
    try {
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
    const q = query(
      ordersRef,
      where("orderDetails.status", "==", "Completed"),
      orderBy("orderDetails.createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const orderList = await Promise.all(
          snapshot.docs.map(async (doc) => {
            const data = doc.data();
            const userDetails = await fetchUserDetails(data.userId);
            return {
              id: doc.id,
              ...data,
              userDetails,
            } as Order;
          })
        );
        setOrders(orderList);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching orders:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

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

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 p-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-6">Completed Orders</h1>
          <div className="mb-6">
            <input
              type="text"
              placeholder="Search by Order ID or Customer Name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full md:w-96 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="bg-white rounded-lg shadow overflow-x-auto">
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
                    Date Completed
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="text-center py-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-4 text-gray-500">
                      No completed orders found
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
                        <span className="px-2 py-1 text-sm text-blue-800 bg-blue-100 rounded-full">
                          {order.orderDetails.paymentMethod}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {formatDate(order.orderDetails.createdAt)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatTime(order.orderDetails.createdAt)}
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
    </ProtectedRoute>
  );
} 