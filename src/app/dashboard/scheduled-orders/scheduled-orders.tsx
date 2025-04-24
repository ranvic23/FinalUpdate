"use client";

import { useEffect, useState } from "react";
import { getScheduledOrders, getReservedStockForDate, ReservedStock, ScheduledOrder } from "../../utils/scheduledOrders";
import { sizeConfigs } from "../../constants/sizeConfigs";

interface SliceReservation {
  varietyName: string;
  slices: number;
}

export default function ScheduledOrdersDashboard() {
  const [scheduledOrders, setScheduledOrders] = useState<ScheduledOrder[]>([]);
  const [reservedStock, setReservedStock] = useState<ReservedStock[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchScheduledOrders();
  }, [selectedDate]);

  const calculateSliceReservations = (order: ScheduledOrder): SliceReservation[] => {
    const sliceReservations: { [key: string]: number } = {};
    
    order.items.forEach(item => {
      const size = sizeConfigs.find(config => config.name === item.productSize);
      if (!size) return;

      const totalSlices = size.totalSlices * item.productQuantity;
      const varietiesCount = item.productVarieties.length;
      const slicesPerVariety = Math.floor(totalSlices / varietiesCount);

      item.productVarieties.forEach(variety => {
        if (!sliceReservations[variety]) {
          sliceReservations[variety] = 0;
        }
        sliceReservations[variety] += slicesPerVariety;
      });
    });

    return Object.entries(sliceReservations).map(([varietyName, slices]) => ({
      varietyName,
      slices
    }));
  };

  const fetchScheduledOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const startDate = new Date(selectedDate);
      const endDate = new Date(selectedDate);
      endDate.setDate(endDate.getDate() + 7); // Show next 7 days

      console.log('Fetching scheduled orders for:', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      const orders = await getScheduledOrders(startDate, endDate);
      console.log('Fetched scheduled orders:', orders);
      setScheduledOrders(orders);

      const stockForDate = await getReservedStockForDate(selectedDate);
      console.log('Fetched reserved stock:', stockForDate);
      setReservedStock(stockForDate);
    } catch (error) {
      console.error("Error fetching scheduled orders:", error);
      setError("Failed to load scheduled orders. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "order confirmed":
        return "bg-blue-100 text-blue-800 border border-blue-200";
      case "stock reserved":
        return "bg-indigo-100 text-indigo-800 border border-indigo-200";
      case "preparing order":
        return "bg-yellow-100 text-yellow-800 border border-yellow-200";
      case "ready for pickup":
        return "bg-emerald-100 text-emerald-800 border border-emerald-200";
      case "completed":
        return "bg-green-100 text-green-800 border border-green-200";
      case "cancelled":
        return "bg-red-100 text-red-800 border border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border border-gray-200";
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Scheduled Orders</h2>
        <div className="flex items-center gap-4">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          />
          <button
            onClick={fetchScheduledOrders}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading scheduled orders...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Scheduled Orders List */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold mb-4">Upcoming Orders</h3>
            <div className="space-y-4">
              {scheduledOrders.length > 0 ? (
                scheduledOrders.map((order) => {
                  const sliceReservations = calculateSliceReservations(order);
                  return (
                  <div
                    key={order.id}
                    className="border rounded-lg p-4 hover:bg-gray-50"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="font-medium">{order.customerName}</h4>
                        <p className="text-sm text-gray-500">
                          Pickup: {formatDate(order.pickupDate)} at{" "}
                          {order.pickupTime}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                    </div>
                    <div className="mt-2">
                      <h5 className="text-sm font-medium mb-1">Items:</h5>
                      <ul className="text-sm text-gray-600">
                        {order.items.map((item, index) => (
                          <li key={index} className="mb-1">
                            {item.productQuantity}x {item.productSize} -{" "}
                            {item.productVarieties.join(", ")}
                          </li>
                        ))}
                      </ul>
                        <div className="mt-3 pt-3 border-t">
                          <h5 className="text-sm font-medium mb-1">Reserved Slices:</h5>
                          <ul className="text-sm text-gray-600">
                            {sliceReservations.map((reservation, index) => (
                              <li key={index} className="mb-1">
                                {reservation.varietyName}: {reservation.slices} slices
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No scheduled orders for this period
                </p>
              )}
            </div>
          </div>

          {/* Reserved Stock */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold mb-4">Reserved Stock</h3>
            <div className="space-y-4">
              {reservedStock.length > 0 ? (
                reservedStock.map((stock) => (
                  <div
                    key={stock.id}
                    className="border rounded-lg p-4 hover:bg-gray-50"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium">{stock.varietyName}</h4>
                        <p className="text-sm text-gray-500">
                          Reserved: {stock.quantity} slices
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                          stock.orderStatus
                        )}`}
                      >
                        {stock.orderStatus}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-2">
                      For pickup at: {stock.pickupTime}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No reserved stock for this date
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 