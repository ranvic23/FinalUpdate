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
  type: 'variety' | 'fixed';
  severity: 'critical' | 'low';
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
  type: 'variety' | 'fixed';
  variety: string;
  bilao: number;
  productionDate?: string;
  expiryDate?: string;
  lastUpdated?: string;
  size?: string;
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

// Add new interfaces for the report preview
interface SalesReportData {
  title: string;
  period: string;
  totalSales: number;
  totalTransactions: number;
  transactions: {
  id: string;
    customerName: string;
    amount: number;
    date: Date;
  }[];
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
  const [orderAlerts, setOrderAlerts] = useState({
    scheduled: 0,
    online: 0,
    total: 0
  });
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
      tension: 0.1
    }]
  });
  const [inventoryMetrics, setInventoryMetrics] = useState({ totalValue: 0, totalItems: 0 });
  const [stockList, setStockList] = useState<Stock[]>([]);

  const [productSortBy, setProductSortBy] = useState<'quantity' | 'revenue'>('quantity');
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [reportData, setReportData] = useState<SalesReportData | null>(null);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(checkNewOrders, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([
        fetchSalesData(),
        fetchPopularProducts(),
        fetchRecentOrders(),
        fetchLowStockItems(),
        fetchInventoryMetrics(),
        fetchStockList(),
        fetchOrderAlerts(),
        checkNewOrders()
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
      const walkInOrdersRef = collection(db, "walkInOrders"); // Reference to walk-in orders
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Calculate week start (Monday) and end (Sunday)
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust to get Monday
      const weekStart = new Date(today);
      weekStart.setDate(diff);
      weekStart.setHours(0, 0, 0, 0);
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      
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

      const walkInOrdersQuery = query(
        walkInOrdersRef,
        where("status", "==", "completed"),
        orderBy("createdAt", "desc")
      );

      const [completedOrdersSnapshot, walkInOrdersSnapshot] = await Promise.all([
        getDocs(completedOrdersQuery),
        getDocs(walkInOrdersQuery)
      ]);
      
      let dailyTotal = 0;
      let weeklyTotal = 0;
      let monthlyTotal = 0;
      
      // Initialize last 7 days data starting from Monday
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        return {
          date: date.toISOString().split('T')[0],
          total: 0
        };
      });

      // Process completed orders
      completedOrdersSnapshot.forEach((doc) => {
        const orderData = doc.data();
        const completedDate = new Date(orderData.orderDetails.updatedAt);
        const amount = orderData.orderDetails.totalAmount || 0;

        // Check if order was completed today
        if (completedDate.toDateString() === today.toDateString()) {
          dailyTotal += amount;
        }

        // Check if order was completed in the current week (Monday to Sunday)
        if (completedDate >= weekStart && completedDate <= weekEnd) {
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

      // Process walk-in orders
      walkInOrdersSnapshot.forEach((doc) => {
        const orderData = doc.data();
        const completedDate = new Date(orderData.createdAt);
        const amount = orderData.totalAmount || 0;

        // Check if order was completed today
        if (completedDate.toDateString() === today.toDateString()) {
          dailyTotal += amount;
        }

        // Check if order was completed in the current week (Monday to Sunday)
        if (completedDate >= weekStart && completedDate <= weekEnd) {
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
      // Fetch variety stocks
      const varietyStocksRef = collection(db, "varietyStocks");
      const varietySnapshot = await getDocs(varietyStocksRef);
      const varietyStocks = varietySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Stock[];

      // Fetch fixed size stocks
      const fixedStocksRef = collection(db, "fixedSizeStocks");
      const fixedSnapshot = await getDocs(fixedStocksRef);
      const fixedStocks = fixedSnapshot.docs.map(doc => ({
          id: doc.id,
        ...doc.data()
      })) as Stock[];

      // Combine and filter low stock items
      const allStocks = [...varietyStocks, ...fixedStocks];
      const lowStocks = allStocks
        .filter(stock => {
          const stockLevel = stock.type === 'variety' ? stock.bilao : stock.quantity;
          return stockLevel <= stock.minimumStock;
        })
        .map(stock => ({
          id: stock.id,
          name: stock.type === 'variety' ? stock.variety : `${stock.variety} (${stock.size})`,
          currentStock: stock.type === 'variety' ? stock.bilao : stock.quantity || 0,
          minimumStock: stock.minimumStock,
          criticalLevel: stock.criticalLevel,
          type: stock.type,
          severity: (stock.type === 'variety' ? stock.bilao : stock.quantity || 0) <= stock.criticalLevel ? 'critical' as const : 'low' as const
        }));

      setLowStockItems(lowStocks);

      // Add notifications for critical stock levels
      const criticalStocks = lowStocks.filter(item => item.severity === 'critical');
      if (criticalStocks.length > 0) {
        setNotifications(prev => [
          ...prev.filter(n => !n.id.startsWith('stock-')), // Remove old stock notifications
          ...criticalStocks.map(item => ({
            id: `stock-${item.id}`,
            message: `Critical stock level: ${item.name} (${item.currentStock} remaining)`,
            type: 'warning' as const,
            createdAt: new Date()
          }))
        ]);
      }
    } catch (error) {
      console.error("Error fetching low stock items:", error);
          setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch stock levels",
        type: 'error',
        createdAt: new Date()
      }]);
    }
  };

  const fetchInventoryMetrics = async () => {
    try {
      // Fetch variety stocks
      const varietyStocksRef = collection(db, "varietyStocks");
      const varietySnapshot = await getDocs(varietyStocksRef);
      const varietyStocks = varietySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Stock[];

      // Fetch fixed size stocks
      const fixedStocksRef = collection(db, "fixedSizeStocks");
      const fixedSnapshot = await getDocs(fixedStocksRef);
      const fixedStocks = fixedSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Stock[];

      // Calculate total items
      const totalVarietyItems = varietyStocks.reduce((sum, stock) => sum + (stock.bilao || 0), 0);
      const totalFixedItems = fixedStocks.reduce((sum, stock) => sum + (stock.quantity || 0), 0);

      setInventoryMetrics({
        totalValue: 0, // You can add price calculation if needed
        totalItems: totalVarietyItems + totalFixedItems
      });
    } catch (error) {
      console.error("Error fetching inventory metrics:", error);
    }
  };

  const fetchStockList = async () => {
    try {
      // Fetch variety stocks
      const varietyStocksRef = collection(db, "varietyStocks");
      const varietySnapshot = await getDocs(varietyStocksRef);
      const varietyStocks = varietySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Stock[];

      // Fetch fixed size stocks
      const fixedStocksRef = collection(db, "fixedSizeStocks");
      const fixedSnapshot = await getDocs(fixedStocksRef);
      const fixedStocks = fixedSnapshot.docs.map(doc => ({
            id: doc.id,
        ...doc.data()
      })) as Stock[];

      // Combine both types of stocks
      setStockList([...varietyStocks, ...fixedStocks]);
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

  const fetchOrderAlerts = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Fetch online orders (pending and processing) excluding cash payments
      const onlineOrdersRef = collection(db, "orders");
      const onlineQuery = query(
        onlineOrdersRef,
        where("orderDetails.status", "in", ["Pending", "Processing"]),
        where("orderDetails.orderType", "==", "online"),
        where("orderDetails.paymentMethod", "!=", "Cash") // Exclude cash payments
      );
      const onlineSnapshot = await getDocs(onlineQuery);

      // Fetch scheduled orders for tomorrow
      const scheduledOrdersRef = collection(db, "orders");
      const scheduledQuery = query(
        scheduledOrdersRef,
        where("orderDetails.status", "in", ["Pending", "Processing"]),
        where("orderDetails.orderType", "==", "scheduled"),
        where("orderDetails.pickupDate", ">=", tomorrow.toISOString()),
        where("orderDetails.pickupDate", "<", new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000).toISOString())
      );
      const scheduledSnapshot = await getDocs(scheduledQuery);

      setOrderAlerts({
        scheduled: scheduledSnapshot.size,
        online: onlineSnapshot.size,
        total: scheduledSnapshot.size + onlineSnapshot.size
      });

    } catch (error) {
      console.error("Error fetching order alerts:", error);
      setNotifications(prev => [...prev, {
        id: `error-${Date.now()}`,
        message: "Failed to fetch order alerts",
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
        where("orderDetails.paymentMethod", "!=", "Cash"), // Exclude cash payments from verification
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

  // Modify generateSalesReport function
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

      // Fetch completed orders
      const ordersSnapshot = await getDocs(query(
        collection(db, "orders"),
        where("orderDetails.status", "==", "Completed"),
        where("orderDetails.paymentStatus", "==", "approved"),
        where("orderDetails.updatedAt", ">=", startDate.toISOString()),
        where("orderDetails.updatedAt", "<=", endDate.toISOString())
      ));

      // Fetch completed walk-in orders
      const walkInOrdersSnapshot = await getDocs(query(
        collection(db, "walkInOrders"),
        where("status", "==", "completed"),
        where("createdAt", ">=", startDate.toISOString()),
        where("createdAt", "<=", endDate.toISOString())
      ));

      const orders = ordersSnapshot.docs.map(doc => {
        const data = doc.data();
        let customerName = 'Walk-in Customer';
        let amount = 0;

        try {
          const rawAmount = data.orderDetails?.totalAmount;
          if (typeof rawAmount === 'number') {
            amount = rawAmount;
          } else if (typeof rawAmount === 'string') {
            amount = parseFloat(rawAmount);
          }
          
          if (isNaN(amount) || amount < 0) {
            console.warn(`Invalid amount for order ${doc.id}: ${rawAmount}`);
            amount = 0;
          }

          if (data.orderType === 'walk-in' && data.customerName) {
            customerName = data.customerName;
          } else if (data.userDetails?.firstName || data.userDetails?.lastName) {
            customerName = `${data.userDetails.firstName || ''} ${data.userDetails.lastName || ''}`.trim();
          } else if (data.customerDetails?.name) {
            customerName = data.customerDetails.name;
          }

          const date = new Date(data.orderDetails.updatedAt);
          if (isNaN(date.getTime())) {
            throw new Error(`Invalid date for order ${doc.id}`);
          }

          return {
            id: doc.id,
            amount,
            date,
            customerName
          };
        } catch (error) {
          console.error(`Error processing order ${doc.id}:`, error);
          return {
            id: doc.id,
            amount: 0,
            date: new Date(data.orderDetails?.updatedAt || new Date()),
            customerName
          };
        }
      });

      // Process walk-in orders
      const walkInOrders = walkInOrdersSnapshot.docs.map(doc => {
        const data = doc.data();
        const amount = data.totalAmount || 0;
        const date = new Date(data.createdAt);

        return {
          id: doc.id,
          amount,
          date,
          customerName: data.customerName || "Walk-in Customer"
        };
      });

      // Combine both orders
      const allOrders = [...orders, ...walkInOrders];

      const validOrders = allOrders.filter(order => !isNaN(order.amount) && order.amount > 0);
      const totalSales = validOrders.reduce((sum, order) => sum + order.amount, 0);
      const totalTransactions = validOrders.length;

      // Set report data for preview
      setReportData({
        title: reportTitle,
        period: `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
        totalSales,
        totalTransactions,
        transactions: validOrders
      });

      // Show the preview modal
      setShowReportPreview(true);

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

  const downloadReport = () => {
    if (!reportData) return;

    const doc = new jsPDF();
    
    // Add title
    doc.setFontSize(20);
    doc.text(reportData.title, 14, 20);
    
    // Add report period
    doc.setFontSize(12);
    doc.text(`Period: ${reportData.period}`, 14, 30);
    
    // Add summary
    doc.setFontSize(14);
    doc.text('Summary', 14, 40);
    doc.setFontSize(12);
    doc.text(`Total Sales: ₱${reportData.totalSales.toLocaleString()}`, 14, 50);
    doc.text(`Total Transactions: ${reportData.totalTransactions}`, 14, 60);
    
    // Add transactions table
    doc.setFontSize(14);
    doc.text('Transaction Details', 14, 80);
    
    // Prepare table data
    const tableData = reportData.transactions.map(order => [
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
    doc.save(`${reportData.title.toLowerCase().replace(/\s+/g, '-')}.pdf`);

    setNotifications(prev => [...prev, {
      id: `report-${Date.now()}`,
      message: `${reportData.title} downloaded successfully`,
      type: 'success',
      createdAt: new Date()
    }]);
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

          {/* Summary Cards */}
          <div className="grid grid-cols-5 gap-4 mb-8">
            <div 
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => generateSalesReport('daily')}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500">Daily Sales</h3>
                <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                  </svg>
                </span>
              </div>
              <p className="text-xl font-semibold text-gray-900">₱{salesData.daily.toLocaleString()}</p>
            </div>

            <div 
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => generateSalesReport('weekly')}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500">Weekly Sales</h3>
                <span className="p-2 bg-green-50 text-green-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18"/>
                    <path d="m19 9-5 5-4-4-3 3"/>
                  </svg>
                </span>
              </div>
              <p className="text-xl font-semibold text-gray-900">₱{salesData.weekly.toLocaleString()}</p>
            </div>

            <div 
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => generateSalesReport('monthly')}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500">Monthly Sales</h3>
                <span className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </span>
              </div>
              <p className="text-xl font-semibold text-gray-900">₱{salesData.monthly.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Last month</p>
            </div>

            <div 
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push('/orders/tracking-orders')}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500">Order Alerts</h3>
                <span className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 0 1-8 0"/>
                  </svg>
                </span>
              </div>
              <p className="text-xl font-semibold text-gray-900">{orderAlerts.total}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                  {orderAlerts.scheduled} Tomorrow
                </span>
                <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
                  {orderAlerts.online} Online
                </span>
              </div>
            </div>

            <div 
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push('/inventory/stock-management')}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500">Stock Alerts</h3>
                <span className="p-2 bg-red-50 text-red-600 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </span>
              </div>
              <p className="text-xl font-semibold text-gray-900">{lowStockItems.length}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">
                  {lowStockItems.filter(item => item.severity === 'critical').length} Critical
                </span>
                <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full">
                  {lowStockItems.filter(item => item.severity === 'low').length} Low
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
                      {lowStockItems.filter(item => item.severity === 'critical').length} Critical
                    </span>
                    <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                      {lowStockItems.filter(item => item.severity === 'low').length} Low
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
                    {lowStockItems.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {item.type === 'variety' ? 'Variety' : 'Size'}
                            </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {item.name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {item.currentStock}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            item.severity === 'critical' ? 'bg-red-100 text-red-800' :
                            item.severity === 'low' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {item.severity === 'critical' ? 'Critical' : item.severity === 'low' ? 'Low Stock' : 'In Stock'}
                          </span>
                        </td>
                      </tr>
                    ))}
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
            
            {/* Fixed Size Stocks */}
            <div className="mb-4">
              <div className="px-6 py-3 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">Fixed Sizes</h4>
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
                    {stockList.filter(item => item.type === 'fixed').map((stock) => (
                      <tr key={stock.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap w-1/3">
                          <div className="text-sm font-medium text-gray-900">
                            {`${stock.variety} (${stock.size})`}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap w-1/3">
                          <div className="text-sm text-gray-900">
                            {stock.quantity}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            stock.quantity <= stock.criticalLevel ? 'bg-red-100 text-red-800' :
                            stock.quantity <= stock.minimumStock ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {stock.quantity <= stock.criticalLevel ? 'Critical' : 
                             stock.quantity <= stock.minimumStock ? 'Low Stock' : 'In Stock'}
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
                        Stock Level (Bilao)
                    </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {stockList.filter(item => item.type === 'variety').map((stock) => (
                    <tr key={stock.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap w-1/3">
                        <div className="text-sm font-medium text-gray-900">
                            {stock.variety}
                        </div>
                      </td>
                        <td className="px-6 py-4 whitespace-nowrap w-1/3">
                        <div className="text-sm text-gray-900">
                            {stock.bilao}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            stock.bilao <= stock.criticalLevel ? 'bg-red-100 text-red-800' :
                            stock.bilao <= stock.minimumStock ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                            {stock.bilao <= stock.criticalLevel ? 'Critical' : 
                             stock.bilao <= stock.minimumStock ? 'Low Stock' : 'In Stock'}
                        </span>
                      </td>
                    </tr>
                  ))}
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

        {/* Report Preview Modal */}
        {showReportPreview && reportData && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-lg w-11/12 max-w-4xl max-h-[90vh] overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">{reportData.title}</h2>
                  <button 
                    onClick={() => setShowReportPreview(false)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
        </div>
              </div>
              
              <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                <div className="mb-6">
                  <p className="text-sm text-gray-600">Period: {reportData.period}</p>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <p className="text-sm text-blue-600">Total Sales</p>
                      <p className="text-2xl font-semibold text-blue-900">₱{reportData.totalSales.toLocaleString()}</p>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <p className="text-sm text-green-600">Total Transactions</p>
                      <p className="text-2xl font-semibold text-green-900">{reportData.totalTransactions}</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reportData.transactions.map((transaction) => (
                        <tr key={transaction.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            #{transaction.id.slice(0, 6)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {transaction.customerName}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ₱{transaction.amount.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {transaction.date.toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {transaction.date.toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-6 border-t border-gray-200">
                <div className="flex justify-end gap-4">
                  <button
                    onClick={() => setShowReportPreview(false)}
                    className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={downloadReport}
                    className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Download PDF
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
