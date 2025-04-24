import { db } from "@/app/firebase-config";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
  DocumentReference,
  orderBy,
} from "firebase/firestore";
import { sizeConfigs } from "../constants/sizeConfigs";

// Interfaces
export interface ReservedStock {
  id?: string;
  varietyId: string;
  varietyName: string;
  bilao: number;
  reservedFor: string; // ISO date string
  orderId: string;
  orderStatus: string;
  pickupTime: string;
}

export interface ScheduledOrder {
  id: string;
  orderId: string;
  customerName: string;
  pickupDate: string;
  pickupTime: string;
  items: Array<{
    productSize: string;
    productVarieties: string[];
    productQuantity: number;
  }>;
  status: string;
  reservedStockIds: string[];
}

// Constants
export const SCHEDULED_STATUS_FLOW = [
  "Order Confirmed",
  "Stock Reserved",
  "Preparing Order",
  "Ready for Pickup",
  "Completed",
  "Cancelled"
] as const;

// Define status flows
export const regularStatusFlow = [
  "Order Confirmed",
  "Preparing Order",
  "Ready for Pickup",
  "Completed",
  "Cancelled"
] as const;

// Define the status types
export type RegularStatus = typeof regularStatusFlow[number];
export type ScheduledStatus = typeof SCHEDULED_STATUS_FLOW[number];
export type OrderStatus = RegularStatus | ScheduledStatus;

// Utility Functions
export const calculateRequiredStock = (
  size: string,
  varieties: string[],
  quantity: number
): { variety: string; bilao: number }[] => {
  const sizeConfig = sizeConfigs.find(s => s.name === size);
  if (!sizeConfig) return [];

  const bilaoPerUnit = sizeConfig.totalSlices;
  const totalBilao = bilaoPerUnit * quantity;
  const bilaoPerVariety = totalBilao / varieties.length;

  return varieties.map(variety => ({
    variety,
    bilao: bilaoPerVariety
  }));
};

export const reserveStock = async (
  orderId: string,
  items: Array<{
    productSize: string;
    productVarieties: string[];
    productQuantity: number;
  }>,
  pickupDate: string,
  pickupTime: string
): Promise<string[]> => {
  const reservedStockIds: string[] = [];

  try {
    // Calculate total required stock for each variety
    const requiredStock = new Map<string, number>();
    
    items.forEach(item => {
      const stockNeeded = calculateRequiredStock(
        item.productSize,
        item.productVarieties,
        item.productQuantity
      );
      
      stockNeeded.forEach(({ variety, bilao }) => {
        const current = requiredStock.get(variety) || 0;
        requiredStock.set(variety, current + bilao);
      });
    });

    // Create reserved stock entries
    const reservedStockRef = collection(db, "reserved_stock");
    
    for (const [variety, quantity] of requiredStock.entries()) {
      const reservedStock: Omit<ReservedStock, 'id'> = {
        varietyId: variety,
        varietyName: variety,
        bilao: quantity,
        reservedFor: pickupDate,
        orderId,
        orderStatus: "Order Confirmed",
        pickupTime
      };

      const docRef = await addDoc(reservedStockRef, reservedStock);
      reservedStockIds.push(docRef.id);
    }

    return reservedStockIds;
  } catch (error) {
    console.error("Error reserving stock:", error);
    throw error;
  }
};

export const updateReservedStock = async (
  orderId: string,
  newStatus: OrderStatus
): Promise<void> => {
  try {
    const reservedStockRef = collection(db, "reserved_stock");
    const q = query(reservedStockRef, where("orderId", "==", orderId));
    const snapshot = await getDocs(q);

    const updatePromises = snapshot.docs.map(doc =>
      updateDoc(doc.ref, { orderStatus: newStatus })
    );

    await Promise.all(updatePromises);
  } catch (error) {
    console.error("Error updating reserved stock status:", error);
    throw error;
  }
};

export const releaseReservedStock = async (
  orderId: string,
  status: OrderStatus
): Promise<void> => {
  try {
    const reservedStockRef = collection(db, "reserved_stock");
    const q = query(reservedStockRef, where("orderId", "==", orderId));
    const snapshot = await getDocs(q);

    // If order is completed or cancelled, delete the reserved stock
    if (status === "Completed" || status === "Cancelled") {
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
    } else {
      // Otherwise just update the status
      const updatePromises = snapshot.docs.map(doc =>
        updateDoc(doc.ref, { orderStatus: status })
      );
      await Promise.all(updatePromises);
    }
  } catch (error) {
    console.error("Error releasing reserved stock:", error);
    throw error;
  }
};

export const getScheduledOrders = async (
  startDate: Date,
  endDate: Date
): Promise<ScheduledOrder[]> => {
  try {
    const ordersRef = collection(db, "orders");
    const q = query(
      ordersRef,
      where("orderDetails.pickupDate", ">=", startDate.toISOString()),
      where("orderDetails.pickupDate", "<=", endDate.toISOString()),
      where("orderDetails.isScheduled", "==", true),
      orderBy("orderDetails.pickupDate", "asc")
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      const status = data.orderDetails.status;
      
      // For cancelled orders, ensure we don't show reserved stock
      const reservedStockIds = status === "Cancelled" ? [] : (data.orderDetails.reservedStockIds || []);
      
      return {
        id: doc.id,
        orderId: doc.id,
        customerName: data.userDetails ? 
          `${data.userDetails.firstName} ${data.userDetails.lastName}` : 
          data.customerName || "Walk-in Customer",
        pickupDate: data.orderDetails.pickupDate,
        pickupTime: data.orderDetails.pickupTime,
        items: data.items.map((item: any) => ({
          productSize: item.productSize,
          productVarieties: item.productVarieties,
          productQuantity: item.productQuantity
        })),
        status: status,
        reservedStockIds: reservedStockIds
      };
    });
  } catch (error) {
    console.error("Error fetching scheduled orders:", error);
    throw error;
  }
};

export const getReservedStockForDate = async (
  date: string
): Promise<ReservedStock[]> => {
  try {
    const reservedStockRef = collection(db, "reserved_stock");
    const q = query(
      reservedStockRef, 
      where("reservedFor", "==", date),
      where("orderStatus", "!=", "Cancelled")
    );
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ReservedStock[];
  } catch (error) {
    console.error("Error fetching reserved stock:", error);
    throw error;
  }
}; 