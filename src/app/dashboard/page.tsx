"use client"; // Required for using hooks

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "../firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy, limit, Timestamp, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase-config"; // Adjust the import based on your setup
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface SalesData {
  daily: number;
  weekly: number;
  monthly: number;
  trend: { date: string; sales: number }[];
}

interface PopularProduct {
  name: string;
  totalSlices: number;
  revenue: number;
}

interface RecentOrder {
  id: string;
  customerName: string;
  total: number;
  status: string;
  date: Date;
}

interface LowStockItem {
  id: string;
  name: string;
  currentStock: number;
  minimumStock: number;
  criticalLevel: number;
  type: 'size' | 'variety';
  severity: 'critical' | 'low';
  varieties?: string[];
}

interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    borderColor?: string | string[];
    backgroundColor?: string | string[];
    tension?: number;
    borderWidth?: number;
  }[];
}

interface Stock {
  id: string;
  quantity: number;
  minimumStock: number;
  criticalLevel: number;
  type: 'size' | 'variety';
  productName?: string;
  unit?: string;
  supplier?: string;
  supplierContact?: string;
  supplierEmail?: string;
  receivedDate?: string;
  lastUpdated?: Date;
  price?: number;
  category?: string;
  location?: string;
  remarks?: string;
  size?: string;
  variety?: string;
  totalSlices?: number;
  sizeName?: string;
  slicesPerUnit?: number;
}

interface OrderData {
  id: string;
  orderType: string;
  customerName: string;
  orderDetails: {
    status: string;
    orderStatus: string;
    completedAt: string;
    totalAmount: number;
    customerName: string;
    createdAt: string;
    updatedAt: string;
    isWalkin: boolean;
  };
  userDetails?: {
  firstName: string;
  lastName: string;
  };
  customerDetails?: {
    name: string;
  };
  items: any[];
}

interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning';
  orderId?: string;
  createdAt: Date;
  isOrderNotification?: boolean;
}

export default function Dashboard() {
  const router = useRouter(); // Next.js navigation
  const [salesData, setSalesData] = useState<SalesData>({ daily: 0, weekly: 0, monthly: 0, trend: [] });
  const [popularProducts, setPopularProducts] = useState<PopularProduct[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalInventoryValue, setTotalInventoryValue] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [salesChartData, setSalesChartData] = useState<ChartData>({
    labels: [],
    datasets: [{
      label: 'Sales',
      data: [],
      borderColor: 'rgb(75, 192, 192)',
      backgroundColor: 'rgba(75, 192, 192, 0.5)',
      tension: 0.1
    }]
  });

  const [productChartData, setProductChartData] = useState<ChartData>({
    labels: [],
    datasets: [{
      label: 'Products Sold',
      data: [],
      backgroundColor: [
        'rgba(255, 99, 132, 0.5)',
        'rgba(54, 162, 235, 0.5)',
        'rgba(255, 206, 86, 0.5)',
        'rgba(75, 192, 192, 0.5)',
        'rgba(153, 102, 255, 0.5)',
      ],
      borderColor: [
        'rgba(255, 99, 132, 1)',
        'rgba(54, 162, 235, 1)',
        'rgba(255, 206, 86, 1)',
        'rgba(75, 192, 192, 1)',
        'rgba(153, 102, 255, 1)',
      ],
      borderWidth: 1
    }]
  });

  const [stock, setStock] = useState<Stock>({
    id: '',
    quantity: 0,
    minimumStock: 0,
    criticalLevel: 0,
    type: 'size'
  });

  const [stockList, setStockList] = useState<Stock[]>([]);
  const [outOfStockItems, setOutOfStockItems] = useState<Stock[]>([]);
  const [hasNewOrders, setHasNewOrders] = useState(false);
  const [lastCheckedOrder, setLastCheckedOrder] = useState<string | null>(null);

  // Add new state for product sort
  const [productSortBy, setProductSortBy] = useState<'quantity' | 'revenue'>('quantity');

  useEffect(() => {
    fetchDashboardData();
    fetchStockList();
    
    // Check for new orders immediately
    checkNewOrders();
    
    // Set up interval to check for new orders every 10 seconds
    const orderCheckInterval = setInterval(checkNewOrders, 10000);
    
    return () => {
      clearInterval(orderCheckInterval);
    };
  }, []);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([
        fetchSalesData(),
        fetchPopularProducts(),
        fetchRecentOrders(),
        fetchLowStockItems(),
        fetchInventoryMetrics()
      ]);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch dashboard data",
        type: 'error',
        createdAt: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSalesData = async () => {
    try {
      const ordersRef = collection(db, "orders");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      // Calculate last month's date range
      const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
      
      // Query for completed orders only
      const completedOrdersQuery = query(
        ordersRef,
        where("orderDetails.status", "==", "Completed"),
        where("orderDetails.paymentStatus", "==", "approved"),
        orderBy("orderDetails.updatedAt", "desc")
      );

      const querySnapshot = await getDocs(completedOrdersQuery);
      
      let dailyTotal = 0;
      let weeklyTotal = 0;
      let monthlyTotal = 0;
      
      // Initialize last 7 days data
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        return {
          date: date.toISOString().split('T')[0],
          total: 0
        };
      }).reverse();

      querySnapshot.forEach((doc) => {
        const orderData = doc.data();
        const completedDate = new Date(orderData.orderDetails.updatedAt);
        completedDate.setHours(0, 0, 0, 0);
        
        const amount = orderData.orderDetails.totalAmount || 0;

        // Check if order was completed today
        if (completedDate.getTime() === today.getTime()) {
          dailyTotal += amount;
        }

        // Check if order was completed in the last 7 days
        if (completedDate >= weekAgo) {
          weeklyTotal += amount;

          // Add to daily chart data
          const dateStr = completedDate.toISOString().split('T')[0];
          const dayIndex = last7Days.findIndex(day => day.date === dateStr);
          if (dayIndex !== -1) {
            last7Days[dayIndex].total += amount;
          }
        }

        // Check if order was completed in the last month
        if (completedDate >= lastMonthStart && completedDate <= lastMonthEnd) {
          monthlyTotal += amount;
        }
      });

      setSalesData({
        daily: dailyTotal,
        weekly: weeklyTotal,
        monthly: monthlyTotal,
        trend: last7Days.map(day => ({
          date: day.date,
          sales: day.total
        }))
      });

      // Format data for the chart
      const chartData = last7Days.map(day => ({
        name: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }),
        amount: day.total
      }));

      setSalesChartData({
        labels: chartData.map(d => d.name),
        datasets: [{
          label: 'Daily Sales',
          data: chartData.map(d => d.amount),
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.5)',
          tension: 0.1
        }]
      });

      setTotalRevenue(monthlyTotal);

    } catch (error) {
      console.error("Error fetching sales data:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch sales data",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  const fetchPopularProducts = async () => {
    try {
      // Get data from both orders and sales collections
      const [ordersSnapshot, salesSnapshot] = await Promise.all([
        getDocs(query(
          collection(db, "orders"),
          where("orderDetails.status", "==", "Completed")
        )),
        getDocs(collection(db, "sales"))
      ]);
      
      // Aggregate product sales by variety
      const varietySales = new Map();
      
      // Process completed orders
      ordersSnapshot.docs.forEach(doc => {
        const orderData = doc.data();
        if (!orderData.items || !Array.isArray(orderData.items)) return;
        
        orderData.items.forEach((item: any) => {
          if (!item.productVarieties || !Array.isArray(item.productVarieties)) return;
          
          const quantity = Number(item.productQuantity) || 0;
          const price = Number(item.productPrice) || 0;
          
          item.productVarieties.forEach((variety: string) => {
            if (!variety) return;
            
            if (!varietySales.has(variety)) {
              varietySales.set(variety, {
                name: variety,
                quantity: 0,
                revenue: 0
              });
            }
            
            const product = varietySales.get(variety);
            product.quantity += quantity;
            product.revenue += price * quantity;
          });
        });
      });

      // Process sales collection
      salesSnapshot.docs.forEach(doc => {
        const saleData = doc.data();
        if (!saleData.variety) return;

        const quantity = Number(saleData.quantity) || 0;
        const amount = Number(saleData.amount) || 0;
        
        if (!varietySales.has(saleData.variety)) {
          varietySales.set(saleData.variety, {
            name: saleData.variety,
            quantity: 0,
              revenue: 0
            });
          }
        
        const product = varietySales.get(saleData.variety);
        product.quantity += quantity;
        product.revenue += amount;
      });

      // Convert to array and sort based on selected criteria
      const popularProducts = Array.from(varietySales.values())
        .sort((a, b) => productSortBy === 'quantity' ? 
          b.quantity - a.quantity : 
          b.revenue - a.revenue)
        .slice(0, 5);

      setPopularProducts(popularProducts.map(p => ({
        ...p,
        totalSlices: p.quantity // Map quantity to totalSlices for compatibility
      })));

      // Update product chart with proper data formatting
      const chartData = {
        labels: popularProducts.map(p => p.name),
        datasets: [{
          label: productSortBy === 'quantity' ? 'Products Sold' : 'Revenue (₱)',
          data: popularProducts.map(p => 
            productSortBy === 'quantity' ? 
              Math.round(p.quantity) : 
              Math.round(p.revenue)
          ),
          backgroundColor: [
            'rgba(255, 99, 132, 0.5)',
            'rgba(54, 162, 235, 0.5)',
            'rgba(255, 206, 86, 0.5)',
            'rgba(75, 192, 192, 0.5)',
            'rgba(153, 102, 255, 0.5)',
          ],
          borderColor: [
            'rgba(255, 99, 132, 1)',
            'rgba(54, 162, 235, 1)',
            'rgba(255, 206, 86, 1)',
            'rgba(75, 192, 192, 1)',
            'rgba(153, 102, 255, 1)',
          ],
          borderWidth: 1
        }]
      };
      
      setProductChartData(chartData);
      
      console.log('Popular products data:', popularProducts);
      
    } catch (error) {
      console.error("Error fetching popular products:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch popular products",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  const fetchRecentOrders = async () => {
    try {
      const ordersRef = collection(db, "orders");
      const recentQuery = query(
        ordersRef,
        orderBy("orderDetails.createdAt", "desc"),
        limit(10)
      );
      const snapshot = await getDocs(recentQuery);
      
      const orders = await Promise.all(snapshot.docs.map(async (docSnapshot) => {
        const data = docSnapshot.data();
        let customerName;

        // For walk-in orders
        if (data.orderType === "walk-in") {
          customerName = data.customerName || data.customerDetails?.name || "Walk-in Customer";
        } 
        // For registered users
        else {
          if (data.userDetails?.firstName && data.userDetails?.lastName) {
            customerName = `${data.userDetails.firstName} ${data.userDetails.lastName}`.trim();
          } else if (data.customerDetails?.name) {
            customerName = data.customerDetails.name;
          } else if (data.orderDetails.customerName) {
            customerName = data.orderDetails.customerName;
          } else {
            // Fetch user details from customers collection
            try {
              const userRef = doc(db, "customers", data.userId);
              const userDoc = await getDoc(userRef);
              if (userDoc.exists()) {
                const userData = userDoc.data();
                if (userData.name) {
                  const nameParts = userData.name.split(" ");
                  const firstName = nameParts[0];
                  const lastName = nameParts.slice(1).join(" ") || "";
                  customerName = `${firstName} ${lastName}`.trim();
                } else {
                  customerName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim();
                }
              }
            } catch (error) {
              console.error("Error fetching customer details:", error);
              customerName = "Unknown Customer";
            }
          }
        }

        return {
          id: docSnapshot.id,
          customerName: customerName || "Unknown Customer",
          total: data.orderDetails.totalAmount,
          status: data.orderDetails.status,
          date: new Date(data.orderDetails.createdAt)
        };
      }));
      
      setRecentOrders(orders);
    } catch (error) {
      console.error("Error fetching recent orders:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch recent orders",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  const fetchLowStockItems = async () => {
    try {
      const sizeStocksRef = collection(db, "sizeStocks");
      const varietyStocksRef = collection(db, "varietyStocks");

      const [sizeStocksSnapshot, varietyStocksSnapshot] = await Promise.all([
        getDocs(sizeStocksRef),
        getDocs(varietyStocksRef)
      ]);
      
      // Process size stocks
      const sizeStockItems = sizeStocksSnapshot.docs.map(doc => {
        const data = doc.data();
        const currentStock = data.slices || 0;
        const minimumStock = data.minimumStock || 10;
        const criticalLevel = data.criticalLevel || 20;

        // Only include if stock is at or below critical level
        if (currentStock > criticalLevel) {
          return null;
        }

        return {
          id: doc.id,
          name: data.size || 'N/A',
          currentStock,
          minimumStock,
          criticalLevel,
          type: 'size' as const,
          severity: currentStock <= minimumStock ? 'critical' : 'low',
          varieties: []
        } as LowStockItem;
      }).filter((item): item is LowStockItem => item !== null);

      // Process variety stocks
      const varietyStockItems = varietyStocksSnapshot.docs.map(doc => {
        const data = doc.data();
        const currentStock = data.slices || 0;
        const minimumStock = data.minimumStock || 10;
        const criticalLevel = data.criticalLevel || 20;

        // Only include if stock is at or below critical level
        if (currentStock > criticalLevel) {
          return null;
        }

        return {
          id: doc.id,
          name: data.variety || 'N/A',
          currentStock,
          minimumStock,
          criticalLevel,
          type: 'variety' as const,
          severity: currentStock <= minimumStock ? 'critical' : 'low',
          varieties: []
        } as LowStockItem;
      }).filter((item): item is LowStockItem => item !== null);

      // Combine low stock items
      const allStockItems = [...sizeStockItems, ...varietyStockItems];
      
      setLowStockItems(allStockItems);
      
      // Clear existing notifications before adding new ones
      setNotifications([]);
      
      // Update stock notifications
      allStockItems.forEach(item => {
        if (item.currentStock <= item.minimumStock) {
          const itemType = item.type === 'size' ? 'Size' : 'Variety';
          const status = item.currentStock === 0 ? 'Out of Stock' : 'Critical Level';
          const unit = item.type === 'size' ? 'boxes/tray' : 'slices';
          const message = `${status}: ${itemType} - ${item.name} (${item.currentStock} ${unit} remaining)`;
          
          setNotifications(prev => [...prev, {
            id: `stock-${item.id}-${Date.now()}`,
            message,
            type: 'error',
            createdAt: new Date()
          }]);
        } else if (item.currentStock <= item.criticalLevel) {
          const itemType = item.type === 'size' ? 'Size' : 'Variety';
          const unit = item.type === 'size' ? 'boxes/tray' : 'slices';
          const message = `Low Stock: ${itemType} - ${item.name} (${item.currentStock} ${unit} remaining)`;
          
          setNotifications(prev => [...prev, {
            id: `stock-${item.id}-${Date.now()}`,
            message,
            type: 'warning',
            createdAt: new Date()
          }]);
        }
      });
    } catch (error) {
      console.error("Error fetching low stock items:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch inventory alerts",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  const fetchInventoryMetrics = async () => {
    try {
      const [sizeStocksSnapshot, varietyStocksSnapshot] = await Promise.all([
        getDocs(collection(db, "sizeStocks")),
        getDocs(collection(db, "varietyStocks"))
      ]);
      
      let totalValue = 0;
      let totalItems = 0;
      
      // Process size stocks
      sizeStocksSnapshot.docs.forEach(doc => {
        const data = doc.data();
        totalValue += (data.quantity * (data.price || 0)) || 0;
        totalItems += data.quantity || 0;
      });

      // Process variety stocks
      varietyStocksSnapshot.docs.forEach(doc => {
        const data = doc.data();
        totalValue += (data.quantity * (data.price || 0)) || 0;
        totalItems += data.quantity || 0;
      });
      
      setTotalInventoryValue(totalValue);
      setTotalProducts(totalItems);
    } catch (error) {
      console.error("Error fetching inventory metrics:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch inventory metrics",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  const fetchStockList = async () => {
    try {
      const sizeStocksRef = collection(db, "sizeStocks");
      const varietyStocksRef = collection(db, "varietyStocks");

      const sizeStocksSnapshot = await getDocs(sizeStocksRef);
      const varietyStocksSnapshot = await getDocs(varietyStocksRef);

      const sizeStocks = sizeStocksSnapshot.docs.map(doc => {
        const data = doc.data();
        // Get the slices per box/tray based on size
        const slicesConfig = {
          'Big Bilao': 60,
          'Half Tray': 24,
          'Small': 30,
          'Solo': 20,
          'Tray': 48,
          '1/4 Slice': 12,

        };
        
        return {
          id: doc.id,
          quantity: data.slices || 0, // Read quantity from slices field
          minimumStock: data.minimumStock || 10,
          criticalLevel: data.criticalLevel || 20,
          type: 'size' as const,
          sizeName: data.size || 'N/A',
          slicesPerUnit: slicesConfig[data.size as keyof typeof slicesConfig] || 0
        } as Stock;
      });

      const varietyStocks = varietyStocksSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          productName: data.productName || '',
          quantity: data.quantity || 0,
          unit: data.unit || '',
          supplier: data.supplier || '',
          supplierContact: data.supplierContact || '',
          supplierEmail: data.supplierEmail || '',
          minimumStock: data.minimumStock || 10,
          criticalLevel: data.criticalLevel || 20,
          receivedDate: data.receivedDate || '',
          lastUpdated: new Date(data.lastUpdated || Date.now()),
          price: data.price || 0,
          category: data.category || '',
          location: data.location || '',
          remarks: data.remarks || '',
          size: 'N/A',
          variety: data.variety || '',
          totalSlices: data.slices || 0,
          type: 'variety'
        } as Stock;
      });

      const stocks = [...sizeStocks, ...varietyStocks];

      // Sort sizes in a specific order
      const sizeOrder = [ 'Small', 'Solo', 'Tray', '1/4 Slice', 'Half Tray', 'Big Bilao'];
      
      // Sort stocks by type first (size before variety), then by size order
      const organizedStocks = stocks.sort((a, b) => {
        // First sort by type
        if (a.type !== b.type) {
          return a.type === 'size' ? -1 : 1;
        }

        // If both are sizes, sort by size order
        if (a.type === 'size' && b.type === 'size') {
          const indexA = sizeOrder.indexOf(a.size || '');
          const indexB = sizeOrder.indexOf(b.size || '');
          
          if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
          }
          
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
        }
        
        // If both are varieties or if sorting by size failed, sort alphabetically
        return (a.variety || '').localeCompare(b.variety || '');
      });

      setStockList(organizedStocks);
      
      // Map stocks to low stock items with type assertion
      const lowStockItems = [...sizeStocks, ...varietyStocks]
        .filter(stock => stock.quantity <= stock.minimumStock)
        .map(stock => ({
          id: stock.id,
          name: stock.type === 'size' ? stock.sizeName || 'N/A' : stock.productName || 'N/A',
          currentStock: stock.quantity,
          minimumStock: stock.minimumStock,
          criticalLevel: stock.criticalLevel,
          type: stock.type,
          severity: stock.quantity <= stock.criticalLevel ? 'critical' : 'low',
          varieties: []
        } as LowStockItem));

      setLowStockItems(lowStockItems);
      
      // Update out of stock items
      const outOfStock = organizedStocks.filter(stock => 
        stock.type === 'size' ? stock.quantity === 0 : stock.totalSlices === 0
      );
      setOutOfStockItems(outOfStock);
    } catch (error) {
      console.error("Error fetching stock list:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch stock list",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  const checkNewOrders = async () => {
    try {
      const ordersRef = collection(db, "orders");
      const ordersQuery = query(
        ordersRef,
        where("orderDetails.status", "==", "Pending Verification"),
        where("orderDetails.paymentStatus", "==", "pending"),
        orderBy("orderDetails.createdAt", "desc")
      );
      
      const snapshot = await getDocs(ordersQuery);
      
      // Create a map of current order notifications
      const currentOrders = new Map();
      
      snapshot.docs.forEach(doc => {
        const orderData = doc.data();
        const orderId = doc.id;
        let customerName;
        
        // Check if it's a walk-in order
        if (orderData.orderType === "walk-in") {
          customerName = orderData.customerName || "Walk-in Customer";
        } else {
          // For registered users
          customerName = orderData.userDetails?.firstName && orderData.userDetails?.lastName
            ? `${orderData.userDetails.firstName} ${orderData.userDetails.lastName}`
            : orderData.customerName || "Customer";
        }
        
        // Create notification for pending verification orders
        const message = `New order needs verification - ${customerName} (${orderData.orderDetails.paymentMethod})`;
        currentOrders.set(orderId, {
          id: `order-${orderId}`,
          message,
          type: "warning",
          orderId,
          createdAt: new Date(orderData.orderDetails.createdAt),
          isOrderNotification: true
        });
      });

      // Update notifications
      setNotifications(prev => {
        // Keep non-order notifications
        const otherNotifications = prev.filter(n => !n.isOrderNotification);
        // Add new order notifications
        return [...otherNotifications, ...Array.from(currentOrders.values())];
      });
      
    } catch (error) {
      console.error("Error checking new orders:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth); // Sign out user
      router.push("/"); // Redirect to home page
    } catch (error: any) {
      console.error("Logout error:", error.code, error.message);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Logout failed. Please try again.",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  // Add new function to prepare chart data
  const prepareChartData = () => {
    // Prepare sales chart data
    const salesLabels = recentOrders.map(order => 
      new Date(order.date).toLocaleDateString()
    ).reverse();
    const salesData = recentOrders.map(order => order.total).reverse();

    setSalesChartData({
      labels: salesLabels,
      datasets: [{
        label: 'Daily Sales',
        data: salesData,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
        tension: 0.1
      }]
    });

    // Prepare product chart data
    setProductChartData({
      labels: popularProducts.map(p => p.name),
      datasets: [{
        label: 'Products Sold',
        data: popularProducts.map(p => p.totalSlices),
        backgroundColor: [
          'rgba(255, 99, 132, 0.5)',
          'rgba(54, 162, 235, 0.5)',
          'rgba(255, 206, 86, 0.5)',
          'rgba(75, 192, 192, 0.5)',
          'rgba(153, 102, 255, 0.5)',
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(153, 102, 255, 1)',
        ],
        borderWidth: 1
      }]
    });
  };

  useEffect(() => {
    if (recentOrders.length > 0 && popularProducts.length > 0) {
      prepareChartData();
    }
  }, [recentOrders, popularProducts]);

  // Add navigation handlers
  const handleViewAllOrders = () => {
    router.push('/orders');
  };

  const handleViewAllStock = () => {
    router.push('/inventory/stock-management');
  };

  // Update the generateSalesReport function
  const generateSalesReport = async (period: 'daily' | 'weekly' | 'monthly') => {
    try {
      const now = new Date();
      let startDate: Date;
      let endDate = new Date(now);
      let reportTitle = '';

      // Set time to end of day for endDate
      endDate.setHours(23, 59, 59, 999);

      switch (period) {
        case 'daily':
          startDate = new Date(now);
          startDate.setHours(0, 0, 0, 0);
          reportTitle = `Daily Sales Report (${startDate.toLocaleDateString()})`;
          break;
        case 'weekly':
          // Calculate last Monday (same as fetchSalesData)
          const day = now.getDay();
          const diff = now.getDate() - day + (day === 0 ? -6 : 1);
          startDate = new Date(now);
          startDate.setDate(diff);
          startDate.setHours(0, 0, 0, 0);
          reportTitle = `Weekly Sales Report (${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()})`;
          break;
        case 'monthly':
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          reportTitle = `Monthly Sales Report (${startDate.toLocaleString('default', { month: 'long', year: 'numeric' })})`;
          break;
        default:
          startDate = now;
          reportTitle = 'Sales Report';
      }

      // Query completed orders with same logic as fetchSalesData
      const ordersSnapshot = await getDocs(query(
        collection(db, "orders"),
        where("orderDetails.status", "==", "Completed"),
        where("orderDetails.paymentStatus", "==", "approved"),
        where("orderDetails.updatedAt", ">=", startDate.toISOString()),
        where("orderDetails.updatedAt", "<=", endDate.toISOString())
      ));

      // Process orders
      const orders = ordersSnapshot.docs.map(doc => {
        const data = doc.data();
        let customerName = 'Walk-in Customer';

        // Handle walk-in orders
        if (data.orderType === 'walk-in' && data.customerName) {
          customerName = data.customerName;
        }
        // Handle online orders with userDetails
        else if (data.userDetails) {
          customerName = `${data.userDetails.firstName} ${data.userDetails.lastName}`.trim();
        }
        // Handle online orders with customerDetails
        else if (data.customerDetails?.name) {
          customerName = data.customerDetails.name;
        }

        return {
          id: doc.id,
          amount: Number(data.orderDetails.totalAmount) || 0,
          date: new Date(data.orderDetails.updatedAt),
          customerName
        };
      }).sort((a, b) => a.date.getTime() - b.date.getTime());

      // Calculate totals
      const totalSales = orders.reduce((sum, order) => sum + order.amount, 0);
      const totalTransactions = orders.length;

      // Create PDF document
      const doc = new jsPDF();
      
      // Add title
      doc.setFontSize(20);
      doc.text(reportTitle, 14, 20);
      
      // Add report period
      doc.setFontSize(12);
      doc.text(`Period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`, 14, 30);
      
      // Add summary
      doc.setFontSize(14);
      doc.text('Summary', 14, 40);
      doc.setFontSize(12);
      doc.text(`Total Sales: ₱${totalSales.toLocaleString()}`, 14, 50);
      doc.text(`Total Transactions: ${totalTransactions}`, 14, 60);
      
      // Add transactions table
      doc.setFontSize(14);
      doc.text('Transaction Details', 14, 80);
      
      // Prepare table data
      const tableData = orders.map(order => [
        order.id.slice(0, 6),
        order.customerName,
        `₱${order.amount.toLocaleString()}`,
        order.date.toLocaleDateString(),
        order.date.toLocaleTimeString()
      ]);

      // Add table using autoTable
      autoTable(doc, {
        startY: 90,
        head: [['ID', 'Customer', 'Amount', 'Date', 'Time']],
        body: tableData,
        theme: 'grid',
        headStyles: {
          fillColor: [41, 128, 185],
          textColor: 255,
          fontStyle: 'bold'
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245]
        }
      });

      // Save the PDF
      doc.save(`${period}-sales-report-${new Date().toISOString().split('T')[0]}.pdf`);

      setNotifications(prev => [...prev, {
        id: `report-${Date.now()}`,
        message: `${reportTitle} generated successfully`,
        type: 'success',
        createdAt: new Date()
      }]);

    } catch (error) {
      console.error("Error generating sales report:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to generate sales report",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="flex justify-center items-center h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-gray-900"></div>
        </div>
      </ProtectedRoute>
    );
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
    },
  };

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-gray-50">
        <div className="flex-1 p-6">
            {/* Header with Notifications */}
          <div className="flex justify-between items-center mb-8">
              <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">Welcome back! Here's your business overview</p>
        </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <button 
                  onClick={() => setShowNotifications(!showNotifications)} 
                  className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
                  </svg>
            {notifications.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {notifications.length}
              </span>
            )}
                </button>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Logout
          </button>
              </div>
            </div>

            {/* Quick Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div 
              className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => generateSalesReport('daily')}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-500">Daily Sales</h3>
                <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                  </svg>
                </span>
              </div>
              <p className="text-2xl font-semibold text-gray-900">₱{salesData.daily.toLocaleString()}</p>
              </div>

            <div 
              className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => generateSalesReport('weekly')}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-500">Weekly Sales</h3>
                <span className="p-2 bg-green-50 text-green-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18"/>
                    <path d="m19 9-5 5-4-4-3 3"/>
                  </svg>
                </span>
              </div>
              <p className="text-2xl font-semibold text-gray-900">₱{salesData.weekly.toLocaleString()}</p>
            </div>

            <div 
              className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => generateSalesReport('monthly')}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-500">Monthly Sales</h3>
                <span className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </span>
              </div>
              <p className="text-2xl font-semibold text-gray-900">₱{salesData.monthly.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Last month</p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-500">Stock Alerts</h3>
                <span className="p-2 bg-red-50 text-red-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </span>
              </div>
              <p className="text-2xl font-semibold text-gray-900">
                {stockList.filter(item => {
                  const stock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                  return stock === 0 || stock <= item.criticalLevel || stock <= item.minimumStock;
                }).length}
              </p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">
                  {stockList.filter(item => {
                    const stock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                    return stock === 0 || stock <= item.criticalLevel;
                  }).length} Critical
                </span>
                <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full">
                  {stockList.filter(item => {
                    const stock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                    return stock > item.criticalLevel && stock <= item.minimumStock;
                  }).length} Low Stock
                </span>
              </div>
              </div>
            </div>

            {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Sales Trend Chart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-gray-900">Sales Trend</h3>
                <select className="text-sm border-gray-200 rounded-lg focus:ring-blue-500">
                  <option>Last 7 days</option>
                  <option>Last 30 days</option>
                  <option>Last 90 days</option>
                </select>
              </div>
                <div className="h-[300px]">
                <Line options={{
                  ...chartOptions,
                  scales: {
                    y: {
                      beginAtZero: true,
                      grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                      }
                    },
                    x: {
                      grid: {
                        display: false
                      }
                    }
                  }
                }} data={salesChartData} />
                </div>
              </div>

              {/* Popular Products Chart */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-gray-900">Popular Products</h3>
                <select 
                  className="text-sm border-gray-200 rounded-lg focus:ring-blue-500"
                  value={productSortBy}
                  onChange={(e) => {
                    setProductSortBy(e.target.value as 'quantity' | 'revenue');
                    fetchPopularProducts();
                  }}
                >
                  <option value="quantity">By Quantity</option>
                  <option value="revenue">By Revenue</option>
                </select>
              </div>
                <div className="h-[300px]">
                <Bar options={{
                  ...chartOptions,
                  scales: {
                    y: {
                      beginAtZero: true,
                      grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                      },
                      ticks: {
                        callback: function(value) {
                          if (productSortBy === 'revenue') {
                            return '₱' + value.toLocaleString();
                          }
                          return value;
                        }
                      }
                    },
                    x: {
                      grid: {
                        display: false
                      }
                    }
                  }
                }} data={productChartData} />
                </div>
              </div>
            </div>

          {/* Orders and Stock Alerts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Orders Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900">Orders</h3>
                  <button 
                    onClick={() => router.push('/orders/tracking-orders')}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    View All
                  </button>
                </div>
                </div>
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
                        Total
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      </tr>
                    </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                      {recentOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          #{order.id.slice(0, 6)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.customerName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ₱{order.total.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            order.status === 'Completed' ? 'bg-green-100 text-green-800' :
                            order.status === 'Cancelled' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                            }`}>
                              {order.status}
                            </span>
                          </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {order.date.toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            {/* Stock Alerts */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900">Stock Alerts</h3>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
                      {stockList.filter(item => {
                        const stock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                        return stock === 0 || stock <= item.criticalLevel;
                      }).length} Critical
                    </span>
                    <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                      {stockList.filter(item => {
                        const stock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                        return stock > item.criticalLevel && stock <= item.minimumStock;
                      }).length} Low Stock
                    </span>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Current Stock
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {stockList
                      .filter(item => {
                        const stock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                        return stock === 0 || stock <= item.criticalLevel || stock <= item.minimumStock;
                      })
                      .map((item) => {
                        const currentStock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                        const stockLabel = item.type === 'size' ? 'boxes/trays' : 'slices';
                        
                        return (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {item.type === 'size' ? 'Size' : 'Variety'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {item.type === 'size' ? item.sizeName : item.variety}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">
                                {currentStock} {stockLabel}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                currentStock === 0 ? 'bg-red-100 text-red-800' :
                                currentStock <= item.criticalLevel ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'
                              }`}>
                                {currentStock === 0 ? 'Out of Stock' :
                                 currentStock <= item.criticalLevel ? 'Critical' :
                                 'Low Stock'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    {stockList.filter(item => {
                      const stock = item.type === 'size' ? item.quantity : (item.totalSlices || 0);
                      return stock === 0 || stock <= item.criticalLevel || stock <= item.minimumStock;
                    }).length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-sm text-gray-500 text-center">
                          No stock alerts
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Stock List Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900">Stock List</h3>
                <div className="flex gap-2">
                  <button 
                    onClick={() => router.push('/inventory/stock-management')}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    View All
                  </button>
                </div>
              </div>
            </div>
            
            {/* Size Stocks */}
            <div className="mb-4">
              <div className="px-6 py-3 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">Sizes</h4>
                </div>
                <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                        Size
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                        Stock Level
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                        Status
                      </th>
                      </tr>
                    </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {stockList
                      .filter(stock => stock.type === 'size')
                      .map((stock) => (
                        <tr key={stock.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap w-1/3">
                            <div className="text-sm font-medium text-gray-900">
                              {stock.sizeName}
                            </div>
                            <div className="text-xs text-gray-500">
                              {stock.slicesPerUnit} slices per box/tray
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap w-1/3">
                            <div className="text-sm text-gray-900">
                              {stock.quantity} boxes/trays
                            </div>
                            <div className="text-xs text-gray-500">
                              Low Stock: {stock.minimumStock} boxes | Critical: {stock.criticalLevel} boxes
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap w-1/3">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              stock.quantity === 0 ? 'bg-red-100 text-red-800' :
                              stock.quantity <= stock.criticalLevel ? 'bg-red-100 text-red-800' :
                              stock.quantity <= stock.minimumStock ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                            }`}>
                              {stock.quantity === 0 ? 'Out of Stock' :
                               stock.quantity <= stock.criticalLevel ? 'Critical' :
                               stock.quantity <= stock.minimumStock ? 'Low Stock' :
                               'In Stock'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            {/* Variety Stocks */}
            <div>
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-700">Varieties</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                        Variety
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                        Stock Level
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {stockList
                      .filter(stock => stock.type === 'variety')
                      .map((stock) => {
                        const slices = stock.totalSlices || 0;
                        return (
                          <tr key={stock.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap w-1/3">
                              <div className="text-sm font-medium text-gray-900">
                                {stock.variety}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap w-1/3">
                              <div className="text-sm text-gray-900">
                                {slices} slices
                              </div>
                              <div className="text-xs text-gray-500">
                                Low Stock: {stock.minimumStock} | Critical: {stock.criticalLevel}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap w-1/3">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                slices === 0 ? 'bg-red-100 text-red-800' :
                                slices <= stock.criticalLevel ? 'bg-red-100 text-red-800' :
                                slices <= stock.minimumStock ? 'bg-yellow-100 text-yellow-800' :
                                'bg-green-100 text-green-800'
                              }`}>
                                {slices === 0 ? 'Out of Stock' :
                                 slices <= stock.criticalLevel ? 'Critical' :
                                 slices <= stock.minimumStock ? 'Low Stock' :
                                 'In Stock'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
        </div>

        {/* Notification Panel */}
        {showNotifications && (
          <div className="fixed top-20 right-6 w-80 bg-white rounded-xl shadow-lg border border-gray-100 z-50">
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                <span className="text-xs text-gray-500">
                  {notifications.filter(n => n.isOrderNotification).length} Orders | 
                  {notifications.filter(n => !n.isOrderNotification).length} Alerts
                </span>
              </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
              {notifications.length > 0 ? (
                <div>
                  {/* Order Notifications */}
                  {notifications.filter(n => n.isOrderNotification).length > 0 && (
                    <div className="p-2 bg-gray-50">
                      <h4 className="text-xs font-medium text-gray-500 uppercase">Pending Orders</h4>
                    </div>
                  )}
                  {notifications
                    .filter(n => n.isOrderNotification)
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .map((notification) => (
                      <div 
                        key={notification.id}
                        className="p-4 border-b border-gray-100 bg-yellow-50 cursor-pointer hover:bg-yellow-100"
                        onClick={() => router.push(`/orders/tracking-orders?id=${notification.orderId}`)}
                      >
                        <p className="text-sm text-yellow-800">{notification.message}</p>
                        <p className="text-xs text-yellow-600 mt-1">
                          {notification.createdAt.toLocaleTimeString()}
                        </p>
                      </div>
                    ))}
                  
                  {/* Other Notifications */}
                  {notifications.filter(n => !n.isOrderNotification).length > 0 && (
                    <div className="p-2 bg-gray-50">
                      <h4 className="text-xs font-medium text-gray-500 uppercase">Stock Alerts</h4>
                    </div>
                  )}
                  {notifications
                    .filter(n => !n.isOrderNotification)
                    .map((notification, index) => (
                      <div 
                        key={index}
                        className={`p-4 border-b border-gray-100 ${
                    notification.type === 'error' ? 'bg-red-50' :
                    notification.type === 'warning' ? 'bg-yellow-50' :
                    'bg-green-50'
                        }`}
                      >
                    <p className={`text-sm ${
                      notification.type === 'error' ? 'text-red-800' :
                      notification.type === 'warning' ? 'text-yellow-800' :
                      'text-green-800'
                    }`}>
                      {notification.message}
                    </p>
                  </div>
                ))}
              </div>
              ) : (
                <div className="p-4 text-sm text-gray-500 text-center">
                  No new notifications
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100">
                <button
                  onClick={() => setShowNotifications(false)}
                className="w-full px-4 py-2 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
      </div>
    </ProtectedRoute>
  );
}
