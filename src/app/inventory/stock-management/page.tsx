"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, updateDoc, doc, deleteDoc, query, orderBy, where, limit, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { toast } from "react-hot-toast";

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const VARIETIES = [
    'Bibingka',
    'Sapin-Sapin',
    'Kutsinta',
    'Kalamay',
    'Cassava'
];

interface Stock {
    id: string;
    type: 'variety' | 'fixed';
    variety: string;
    bilao: number;
    minimumStock: number;
    criticalLevel: number;
    productionDate?: string;
    expiryDate?: string;
    lastUpdated?: string;
    size?: 'small' | 'solo' | '';
    quantity?: number;
}

interface StockHistory {
    id: string;
    stockId: string;
    variety: string;
    type: 'in' | 'out' | 'adjustment' | 'deleted';
    bilao: number;
    previousBilao: number;
    newBilao: number;
    size?: 'small' | 'solo' | '';
    quantity?: number;
    previousQuantity?: number;
    newQuantity?: number;
    date: Date;
    updatedBy: string;
    remarks: string;
    isDeleted: boolean;
    productionDate?: string;
    expiryDate?: string;
}

interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor?: string;
    tension: number;
  }[];
}

interface OrderDetails {
    orderId: string;
    varieties: string[];
    quantity: number;
    size: string;
}

interface DeductStockParams {
    orderId: string;
    size: string;
    varieties: string[];
    quantity: number;
    isFixedSize?: boolean;
}

// Move the function outside and before the Stock component
export const restoreStockOnCancel = async (orderDetails: OrderDetails) => {
    try {
        // Calculate restoration amount based on size and number of varieties
        const getRestorationAmount = (size: string, varietyCount: number) => {
            // Special case for 1/4 slice
            if (size.toLowerCase() === '1/4 slice' || size.toLowerCase() === '1/4') {
                return 0.25; // Always 0.25 bilao for 1/4 slice
            }

            // For other sizes, calculate based on variety count
            switch (varietyCount) {
                case 1: return 1.0;    // 1 variety = 1 bilao
                case 2: return 0.5;    // 2 varieties = 0.5 bilao each
                case 3: return 0.34;   // 3 varieties ≈ 0.34 bilao each
                case 4: return 0.25;   // 4 varieties = 0.25 bilao each
                default: return 0.25;  // Default to 0.25 for any other case
            }
        };

        const restorationAmount = getRestorationAmount(orderDetails.size, orderDetails.varieties.length);
        const totalBilaoToRestore = restorationAmount * orderDetails.quantity;

        // Restore variety stocks
        const varietyStockRef = collection(db, "varietyStocks");
        const varietySnapshot = await getDocs(varietyStockRef);
        
        // Process each variety in the order
        for (const variety of orderDetails.varieties) {
            // Find matching variety stocks (case-insensitive)
            const matchingDocs = varietySnapshot.docs.filter(doc => {
                const stockVariety = doc.data().variety;
                return stockVariety && stockVariety.toLowerCase() === variety.toLowerCase();
            });

            if (matchingDocs.length > 0) {
                // Restore to the most recently updated stock
                const latestStock = matchingDocs.sort((a, b) => {
                    const dateA = new Date(a.data().lastUpdated || 0);
                    const dateB = new Date(b.data().lastUpdated || 0);
                    return dateB.getTime() - dateA.getTime();
                })[0];

                const varietyData = latestStock.data() as Stock;
                const newVarietyBilao = (varietyData.bilao || 0) + totalBilaoToRestore;

                await updateDoc(latestStock.ref, {
                    bilao: newVarietyBilao,
                    lastUpdated: new Date().toISOString()
                });

                // Add to stock history for variety stock
                const varietyHistoryRef = collection(db, "stockHistory");
                await addDoc(varietyHistoryRef, {
                    stockId: latestStock.id,
                    variety: variety,
                    type: 'in',
                    bilao: totalBilaoToRestore,
                    previousBilao: varietyData.bilao || 0,
                    newBilao: newVarietyBilao,
                    date: new Date(),
                    updatedBy: "System",
                    remarks: `Order cancelled - Restored ${totalBilaoToRestore.toFixed(2)} bilao to ${variety} (${orderDetails.size}, ${orderDetails.varieties.length} varieties)`,
                    isDeleted: false,
                    productionDate: varietyData.productionDate,
                    expiryDate: varietyData.expiryDate
                });
            }
        }
    } catch (error) {
        console.error("Error restoring stock:", error);
        throw error;
    }
};

export const updateStockOnOrderStatus = async (orderDetails: OrderDetails) => {
    try {
        // Process each variety in the order
        for (const variety of orderDetails.varieties) {
            // Get all variety stocks ordered by production date
            const varietyStocksRef = collection(db, "varietyStocks");
            const varietyQuery = query(
                varietyStocksRef,
                where("variety", "==", variety),
                orderBy("productionDate", "asc")
            );
            
            const varietySnapshot = await getDocs(varietyQuery);
            const varietyStocks = varietySnapshot.docs;

            if (varietyStocks.length === 0) {
                throw new Error(`No stock found for variety: ${variety}`);
            }

            // Calculate total available bilao
            const totalAvailableBilao = varietyStocks.reduce((sum, doc) => 
                sum + ((doc.data() as Stock).bilao || 0), 0);

            if (totalAvailableBilao < orderDetails.quantity) {
                throw new Error(`Insufficient bilao for ${variety}. Available: ${totalAvailableBilao}, Needed: ${orderDetails.quantity}`);
            }

            let remainingToDeduct = orderDetails.quantity;

            // Deduct from stocks starting with earliest production date
            for (const varietyDoc of varietyStocks) {
                if (remainingToDeduct <= 0) break;

                const varietyStock = varietyDoc.data() as Stock;
                const currentBilao = varietyStock.bilao || 0;
                const bilaoToDeduct = Math.min(remainingToDeduct, currentBilao);
                const newBilao = currentBilao - bilaoToDeduct;

                await updateDoc(varietyDoc.ref, {
                    bilao: newBilao,
                lastUpdated: new Date().toISOString()
                });

                // Record variety stock history
                await addDoc(collection(db, "stockHistory"), {
                    stockId: varietyDoc.id,
                    variety: variety,
                type: 'out',
                    bilao: bilaoToDeduct,
                    previousBilao: currentBilao,
                    newBilao: newBilao,
                date: new Date(),
                updatedBy: "Order System",
                    remarks: `Order pickup - Order ID: ${orderDetails.orderId} - Deducted ${bilaoToDeduct} bilao`,
                    isDeleted: false,
                    productionDate: varietyStock.productionDate,
                    expiryDate: varietyStock.expiryDate
                });

                remainingToDeduct -= bilaoToDeduct;
            }
        }

        return {
            success: true,
            message: 'Stock updated successfully'
        };

    } catch (error) {
        console.error('Error processing order:', error);
        throw error;
    }
};

// Update the date conversion logic
const formatDate = (dateStr: string | undefined): string => {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleDateString();
    } catch {
        return '-';
    }
};

type BilaoSize = 'big bilao' | '1/4' | '1/4 slice' | 'half tray' | 'tray';

const BILAO_DEDUCTION: Record<BilaoSize, number> = {
    'big bilao': 0.25,    // 1/4 per variety
    '1/4': 0.25,         // 1/4 per variety
    '1/4 slice': 0.25,   // 1/4 per variety
    'half tray': 0.25,   // 1/4 per variety
    'tray': 0.25,        // 1/4 per variety
};

export async function deductStockOnOrder({ orderId, size, varieties, quantity, isFixedSize }: DeductStockParams) {
    try {
        // For fixed size products (Small, Solo), deduct directly from variety stock
        if (isFixedSize) {
            for (const variety of varieties) {
                const varietyStockRef = collection(db, "varietyStocks");
                const q = query(varietyStockRef, where("variety", "==", variety));
                const snapshot = await getDocs(q);

                if (snapshot.empty) {
                    throw new Error(`No stock found for variety: ${variety}`);
                }

                const stockDoc = snapshot.docs[0];
                const currentStock = stockDoc.data().quantity || 0;
                const deduction = quantity;

                if (currentStock < deduction) {
                    throw new Error(`Insufficient stock for variety: ${variety}. Available: ${currentStock}, Needed: ${deduction}`);
                }

                await updateDoc(stockDoc.ref, {
                    quantity: currentStock - deduction
                });
            }
        } else {
            // For bilao-based products and 1/4 slice
            for (const variety of varieties) {
                const varietyStockRef = collection(db, "varietyStocks");
                const q = query(varietyStockRef, where("variety", "==", variety));
                const snapshot = await getDocs(q);

                if (snapshot.empty) {
                    throw new Error(`No stock found for variety: ${variety}`);
                }

                const stockDoc = snapshot.docs[0];
                const currentStock = stockDoc.data().bilao || 0;
                
                // Calculate deduction based on size and number of varieties
                let deductionPerOrder;
                const sizeKey = size.toLowerCase();
                
                if (sizeKey === '1/4' || sizeKey === '1/4 slice') {
                    deductionPerOrder = 0.25; // Always 0.25 for 1/4 slice
                } else if (sizeKey === 'half tray') {
                    // For half tray: 1 bilao if single variety, 0.5 bilao if two varieties
                    deductionPerOrder = varieties.length === 1 ? 1 : 0.5;
                } else if (sizeKey === 'big bilao' || sizeKey === 'tray') {
                    // Deduction based on number of varieties
                    switch (varieties.length) {
                        case 1: deductionPerOrder = 1; break;    // 1 variety = 1 bilao
                        case 2: deductionPerOrder = 0.5; break;  // 2 varieties = 0.5 bilao each
                        case 3: deductionPerOrder = 0.34; break; // 3 varieties ≈ 0.34 bilao each
                        case 4: deductionPerOrder = 0.25; break; // 4 varieties = 0.25 bilao each
                        default: deductionPerOrder = 0.25;       // Default case
                    }
                } else {
                    throw new Error(`Invalid size: ${size}`);
                }

                const totalDeduction = deductionPerOrder * quantity;

                if (currentStock < totalDeduction) {
                    throw new Error(`Insufficient stock for variety: ${variety}. Available: ${currentStock.toFixed(2)}, Needed: ${totalDeduction.toFixed(2)}`);
                }

                await updateDoc(stockDoc.ref, {
                    bilao: currentStock - totalDeduction
                });

                // Log the stock deduction
                await addDoc(collection(db, "stockHistory"), {
                    stockId: stockDoc.id,
                    variety: variety,
                    type: "out",
                    bilao: totalDeduction,
                    previousBilao: currentStock,
                    newBilao: currentStock - totalDeduction,
                    date: new Date(),
                    updatedBy: "Order System",
                    remarks: `Order deduction - ${totalDeduction.toFixed(2)} bilao (${size}, ${varieties.length} varieties)`,
                    isDeleted: false
                });
            }
        }

    } catch (error) {
        console.error("Error deducting stock:", error);
        throw error;
    }
}

export default function Stock() {
    const [stocks, setStocks] = useState<Stock[]>([]);
    const [stockHistory, setStockHistory] = useState<StockHistory[]>([]);

    const [varietyStock, setVarietyStock] = useState<Stock>({
        id: '',
        type: 'variety',
        variety: '',
        bilao: 0,
        minimumStock: 0,
        criticalLevel: 0,
        productionDate: '',
        expiryDate: '',
        lastUpdated: new Date().toISOString()
    });

    const [editStockId, setEditStockId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showLowStock, setShowLowStock] = useState(false);
    const [isAddVarietyOpen, setIsAddVarietyOpen] = useState(false);
    const [newVarietyName, setNewVarietyName] = useState('');
    const [varieties, setVarieties] = useState<{ id: string; name: string }[]>([]);

    const [fixedSizeStock, setFixedSizeStock] = useState<Stock>({
        id: '',
        type: 'fixed',
        variety: 'Bibingka',
        bilao: 0,
        minimumStock: 0,
        criticalLevel: 0,
        productionDate: '',
        expiryDate: '',
        lastUpdated: new Date().toISOString(),
        size: '',
        quantity: 0
    });

    useEffect(() => {
        fetchStocks();
        fetchStockHistory();
        fetchVarieties();
    }, []);

    const fetchStocks = async () => {
        try {
            // Fetch variety stocks
            const varietyStocksRef = collection(db, "varietyStocks");
            const varietyQuery = query(varietyStocksRef, orderBy("productionDate", "asc"));
            const varietySnapshot = await getDocs(varietyQuery);
            const varietyStocks = varietySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Stock[];

            // Fetch fixed size stocks
            const fixedStocksRef = collection(db, "fixedSizeStocks");
            const fixedQuery = query(fixedStocksRef, orderBy("productionDate", "asc"));
            const fixedSnapshot = await getDocs(fixedQuery);
            const fixedStocks = fixedSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Stock[];

            // Combine both types of stocks
            setStocks([...varietyStocks, ...fixedStocks]);
        } catch (error) {
            console.error("Error fetching stocks:", error);
            toast.error("Failed to fetch stocks");
        }
    };

    const fetchStockHistory = async () => {
        try {
            const historyRef = collection(db, "stockHistory");
            const historyQuery = query(
                historyRef,
                orderBy("date", "desc"),
                limit(50)
            );
            const querySnapshot = await getDocs(historyQuery);
            const historyList = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                date: doc.data().date.toDate()
            })) as StockHistory[];
            
            const filteredHistory = historyList.filter(history => !history.isDeleted);
            setStockHistory(filteredHistory);
        } catch (error) {
            console.error("Error fetching stock history:", error);
        }
    };

    const fetchVarieties = async () => {
        try {
            const querySnapshot = await getDocs(collection(db, "varieties"));
            const varietiesList = querySnapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name
            }));
            setVarieties(varietiesList);
        } catch (error) {
            console.error("Error fetching varieties:", error);
        }
    };

    const handleSubmitVarietyStock = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const selectedVariety = (document.getElementById("variety") as HTMLSelectElement).value;
            const bilao = parseInt((document.getElementById("varietyBilao") as HTMLInputElement).value);
            const minimumStock = parseInt((document.getElementById("varietyMinimumStock") as HTMLInputElement).value);
            const criticalLevel = parseInt((document.getElementById("varietyCriticalLevel") as HTMLInputElement).value);
            const productionDate = (document.getElementById("productionDate") as HTMLInputElement).value;
            const expiryDate = (document.getElementById("expiryDate") as HTMLInputElement).value;

            if (!selectedVariety || isNaN(bilao) || bilao <= 0) {
                alert("Please select a product and enter a valid number of bilao");
                return;
            }

            if (isNaN(minimumStock) || minimumStock < 0) {
                alert("Please enter a valid minimum stock level");
                return;
            }

            if (isNaN(criticalLevel) || criticalLevel < 0) {
                alert("Please enter a valid critical level");
                return;
            }

            if (!productionDate || !expiryDate) {
                alert("Please enter production and expiry dates");
                return;
            }

            // Find the exact variety name from the VARIETIES constant
            const exactVarietyName = VARIETIES.find(v => v.toLowerCase() === selectedVariety.toLowerCase());
            if (!exactVarietyName) {
                alert("Invalid product selected");
                    return;
            }

            // Create a new variety stock batch
            const varietyStockRef = collection(db, "varietyStocks");
            const docRef = await addDoc(varietyStockRef, {
                type: "variety",
                variety: exactVarietyName,
                bilao,
                minimumStock,
                criticalLevel,
                productionDate,
                expiryDate,
                    lastUpdated: new Date().toISOString()
            });

            // Add to stock history
            const historyRef = collection(db, "stockHistory");
            await addDoc(historyRef, {
                    stockId: docRef.id,
                variety: exactVarietyName,
                type: "in",
                bilao,
                previousBilao: 0,
                newBilao: bilao,
                    date: new Date(),
                updatedBy: "System",
                remarks: `Added new batch of ${bilao} bilao for ${exactVarietyName}`,
                isDeleted: false,
                productionDate,
                expiryDate
            });

            resetForm();
            fetchStocks();
            toast.success("Product stock added successfully");
        } catch (error) {
            console.error("Error submitting product stock:", error);
            toast.error("Failed to add product stock");
        }
    };

    const handleDelete = async (id: string, type: 'variety' | 'fixed') => {
        if (!confirm("Are you sure you want to delete this stock?")) {
            return;
        }

        try {
            const stockRef = doc(db, "varietyStocks", id);
            const stockDoc = await getDoc(stockRef);
            
            if (!stockDoc.exists()) {
                alert("Stock not found!");
                return;
            }

            const stockData = stockDoc.data();

            await deleteDoc(stockRef);

            await addDoc(collection(db, "stockHistory"), {
                stockId: id,
                variety: stockData.variety,
                type: 'deleted',
                bilao: stockData.bilao,
                previousBilao: stockData.bilao,
                newBilao: 0,
                date: new Date(),
                updatedBy: "Admin",
                remarks: `Product stock deleted`,
                isDeleted: true
            });

            await fetchStocks();
            await fetchStockHistory();
            alert("Stock deleted successfully!");
        } catch (error) {
            console.error("Error deleting stock:", error);
            alert("Failed to delete stock.");
        }
    };

    const resetForm = () => {
        setVarietyStock({
            id: '',
            type: 'variety',
            variety: '',
            bilao: 0,
            minimumStock: 0,
            criticalLevel: 0,
            productionDate: '',
            expiryDate: '',
            lastUpdated: new Date().toISOString()
        });
        setEditStockId(null);
    };

    const handleEdit = (stk: Stock) => {
        setEditStockId(stk.id);
            setVarietyStock(stk);
    };

    const filteredStocks = stocks
        .filter(s => showLowStock ? s.bilao <= s.minimumStock : true)
        .filter(s => !searchTerm || (s.variety?.toLowerCase() ?? '').includes(searchTerm.toLowerCase()));

    // Add this helper function at the top of your component
    const getExpiryStatus = (expiryDate: string) => {
        const expiry = new Date(expiryDate);
        const today = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 3);

        if (expiry <= today) {
            return { status: 'Expired', className: 'bg-red-100 text-red-800' };
        } else if (expiry <= sevenDaysFromNow) {
            return { status: 'Expiring Soon', className: 'bg-yellow-100 text-yellow-800' };
        }
        return { status: 'Valid', className: 'bg-green-100 text-green-800' };
    };

    const handleSubmitFixedSizeStock = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const size = (document.getElementById("fixedSize") as HTMLSelectElement).value as 'small' | 'solo';
            const quantity = parseInt((document.getElementById("fixedQuantity") as HTMLInputElement).value);
            const minimumStock = parseInt((document.getElementById("fixedMinimumStock") as HTMLInputElement).value);
            const criticalLevel = parseInt((document.getElementById("fixedCriticalLevel") as HTMLInputElement).value);
            const productionDate = (document.getElementById("fixedProductionDate") as HTMLInputElement).value;
            const expiryDate = (document.getElementById("fixedExpiryDate") as HTMLInputElement).value;

            if (!size || isNaN(quantity) || quantity <= 0) {
                toast.error("Please select a size and enter a valid quantity");
            return;
        }

            if (isNaN(minimumStock) || minimumStock < 0) {
                toast.error("Please enter a valid minimum stock level");
            return;
        }

            if (isNaN(criticalLevel) || criticalLevel < 0) {
                toast.error("Please enter a valid critical level");
            return;
        }

            if (!productionDate || !expiryDate) {
                toast.error("Please enter production and expiry dates");
            return;
        }

            const fixedStockRef = collection(db, "fixedSizeStocks");
            const docRef = await addDoc(fixedStockRef, {
                type: "fixed",
                variety: "Bibingka",
                size,
                quantity,
                minimumStock,
                criticalLevel,
                productionDate,
                expiryDate,
                lastUpdated: new Date().toISOString()
            });

            // Add to stock history
            const historyRef = collection(db, "stockHistory");
            await addDoc(historyRef, {
                stockId: docRef.id,
                variety: "Bibingka",
                type: "in",
                bilao: 0,
                previousBilao: 0,
                newBilao: 0,
                size,
                quantity,
                date: new Date(),
                updatedBy: "System",
                remarks: `Added new batch of ${quantity} pieces for Bibingka (${size})`,
                isDeleted: false,
                productionDate,
                expiryDate
            });

            resetFixedSizeForm();
            fetchStocks();
            toast.success("Bibingka stock added successfully");
        } catch (error) {
            console.error("Error submitting Bibingka stock:", error);
            toast.error("Failed to add Bibingka stock");
        }
    };

    const resetFixedSizeForm = () => {
        setFixedSizeStock({
            id: '',
            type: 'fixed',
            variety: 'Bibingka',
            bilao: 0,
            minimumStock: 0,
            criticalLevel: 0,
            productionDate: '',
            expiryDate: '',
            lastUpdated: new Date().toISOString(),
            size: '',
            quantity: 0
        });
    };

    const handleAddStock = async (stock: Stock) => {
        try {
            const additionalQuantity = parseInt(prompt(`Enter number of ${stock.type === 'fixed' ? 'pieces' : 'bilao'} to add:`) || '0');
            if (isNaN(additionalQuantity) || additionalQuantity <= 0) {
                toast.error("Please enter a valid number");
                return;
            }

            const stockRef = doc(db, stock.type === 'fixed' ? "fixedSizeStocks" : "varietyStocks", stock.id);
            const currentStock = stock.type === 'fixed' ? (stock.quantity || 0) : (stock.bilao || 0);
            const newStock = currentStock + additionalQuantity;

            await updateDoc(stockRef, {
                ...(stock.type === 'fixed' ? { quantity: newStock } : { bilao: newStock }),
                lastUpdated: new Date().toISOString()
            });

            // Add to stock history
            await addDoc(collection(db, "stockHistory"), {
                stockId: stock.id,
                variety: stock.variety,
                type: "in",
                bilao: stock.type === 'fixed' ? 0 : additionalQuantity,
                previousBilao: stock.type === 'fixed' ? 0 : currentStock,
                newBilao: stock.type === 'fixed' ? 0 : newStock,
                size: stock.size,
                quantity: stock.type === 'fixed' ? additionalQuantity : 0,
                previousQuantity: stock.type === 'fixed' ? currentStock : 0,
                newQuantity: stock.type === 'fixed' ? newStock : 0,
                date: new Date(),
                updatedBy: "System",
                remarks: `Added ${additionalQuantity} ${stock.type === 'fixed' ? 'pieces' : 'bilao'} to ${stock.variety}${stock.size ? ` (${stock.size})` : ''}`,
                isDeleted: false,
                productionDate: stock.productionDate,
                expiryDate: stock.expiryDate
            });

            await fetchStocks();
            await fetchStockHistory();
            toast.success(`Successfully added ${additionalQuantity} ${stock.type === 'fixed' ? 'pieces' : 'bilao'}`);
        } catch (error) {
            console.error("Error adding stock:", error);
            toast.error("Failed to add stock");
        }
    };

    return (
        <ProtectedRoute>
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-2xl font-bold mb-6">Stock Management</h1>
                
                <div className="flex justify-end space-x-2 mb-4">
                    <button
                        onClick={() => setIsAddVarietyOpen(true)}
                        className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                    >
                        Add New Product
                    </button>
                </div>

                {/* Product Stock Form */}
                <div className="p-4 bg-gray-50 rounded mb-8">
                    <h3 className="text-lg font-semibold mb-4">Add Product Stock</h3>
                    <form onSubmit={handleSubmitVarietyStock} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                <label className="block text-sm font-medium mb-2">Product</label>
                                    <select
                                    id="variety"
                                        className="w-full p-2 border rounded"
                                    value={varietyStock.variety}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, variety: e.target.value }))}
                                    required
                                >
                                    <option value="">Select Product...</option>
                                    {varieties.map(variety => (
                                        <option key={variety.id} value={variety.name}>{variety.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                <label className="block text-sm font-medium mb-2">Number of Bilao</label>
                                    <input
                                    id="varietyBilao"
                                        type="number"
                                        className="w-full p-2 border rounded"
                                    value={varietyStock.bilao}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, bilao: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                    disabled={!varietyStock.variety}
                                    />
                                </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Low Stock Level (Bilao)</label>
                                <input
                                    id="varietyMinimumStock"
                                    type="number"
                                    className="w-full p-2 border rounded"
                                    value={varietyStock.minimumStock}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, minimumStock: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                    disabled={!varietyStock.variety}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Critical Level (Bilao)</label>
                                <input
                                    id="varietyCriticalLevel"
                                    type="number"
                                    className="w-full p-2 border rounded"
                                    value={varietyStock.criticalLevel}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, criticalLevel: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                    disabled={!varietyStock.variety}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Production Date</label>
                                <input
                                    id="productionDate"
                                    type="date"
                                    className="w-full p-2 border rounded"
                                    value={varietyStock.productionDate}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, productionDate: e.target.value }))}
                                    required
                                    disabled={!varietyStock.variety}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Expiry Date</label>
                                <input
                                    id="expiryDate"
                                    type="date"
                                    className="w-full p-2 border rounded"
                                    value={varietyStock.expiryDate}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, expiryDate: e.target.value }))}
                                    required
                                    disabled={!varietyStock.variety}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end space-x-3">
                            <button
                                type="button"
                                onClick={resetForm}
                                className="px-4 py-2 border rounded hover:bg-gray-100"
                            >
                                Reset
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                                disabled={loading || !varietyStock.variety}
                            >
                                {loading ? 'Adding...' : 'Add Product Stock'}
                            </button>
                        </div>
                    </form>
                        </div>

                {/* Bibingka Stock Form */}
                <div className="p-4 bg-gray-50 rounded mb-8">
                    <h3 className="text-lg font-semibold mb-4">Add Bibingka Stock</h3>
                    <form onSubmit={handleSubmitFixedSizeStock} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Size</label>
                                <select
                                    id="fixedSize"
                                    className="w-full p-2 border rounded"
                                    value={fixedSizeStock.size}
                                    onChange={(e) => setFixedSizeStock(prev => ({ ...prev, size: e.target.value as 'small' | 'solo' }))}
                                    required
                                >
                                    <option value="">Select Size...</option>
                                    <option value="small">Small</option>
                                    <option value="solo">Solo</option>
                                </select>
                                    </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Quantity</label>
                                <input
                                    id="fixedQuantity"
                                    type="number"
                                    className="w-full p-2 border rounded"
                                    value={fixedSizeStock.quantity}
                                    onChange={(e) => setFixedSizeStock(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                    disabled={!fixedSizeStock.size}
                                />
                                </div>

                                <div>
                                <label className="block text-sm font-medium mb-2">Low Stock Level</label>
                                    <input
                                    id="fixedMinimumStock"
                                        type="number"
                                        className="w-full p-2 border rounded"
                                    value={fixedSizeStock.minimumStock}
                                    onChange={(e) => setFixedSizeStock(prev => ({ ...prev, minimumStock: parseInt(e.target.value) || 0 }))}
                                        min="0"
                                    required
                                    disabled={!fixedSizeStock.size}
                                    />
                                </div>

                                <div>
                                <label className="block text-sm font-medium mb-2">Critical Level</label>
                                    <input
                                    id="fixedCriticalLevel"
                                        type="number"
                                        className="w-full p-2 border rounded"
                                    value={fixedSizeStock.criticalLevel}
                                    onChange={(e) => setFixedSizeStock(prev => ({ ...prev, criticalLevel: parseInt(e.target.value) || 0 }))}
                                        min="0"
                                    required
                                    disabled={!fixedSizeStock.size}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-2">Production Date</label>
                                    <input
                                    id="fixedProductionDate"
                                        type="date"
                                        className="w-full p-2 border rounded"
                                    value={fixedSizeStock.productionDate}
                                    onChange={(e) => setFixedSizeStock(prev => ({ ...prev, productionDate: e.target.value }))}
                                    required
                                    disabled={!fixedSizeStock.size}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-2">Expiry Date</label>
                                    <input
                                    id="fixedExpiryDate"
                                        type="date"
                                        className="w-full p-2 border rounded"
                                    value={fixedSizeStock.expiryDate}
                                    onChange={(e) => setFixedSizeStock(prev => ({ ...prev, expiryDate: e.target.value }))}
                                    required
                                    disabled={!fixedSizeStock.size}
                                    />
                                </div>
                                </div>

                        <div className="flex justify-end space-x-3">
                            <button
                                type="button"
                                onClick={resetFixedSizeForm}
                                className="px-4 py-2 border rounded hover:bg-gray-100"
                            >
                                Reset
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                                disabled={loading || !fixedSizeStock.size}
                            >
                                {loading ? 'Adding...' : 'Add Bibingka Stock'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Stock List */}
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold mb-4">Stock List</h2>
                    
                    {/* Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <input
                            type="text"
                            placeholder="Search by product..."
                            className="p-2 border rounded"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />

                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={showLowStock}
                                onChange={(e) => setShowLowStock(e.target.checked)}
                                className="mr-2"
                            />
                            Show Low Stock Only
                        </label>
                    </div>

                    {/* Product Stock Table */}
                            <div className="overflow-x-auto">
                                <table className="min-w-full">
                                    <thead>
                                        <tr className="bg-gray-50">
                                    <th className="p-3 text-left">Product</th>
                                    <th className="p-3 text-left">Type</th>
                                    <th className="p-3 text-right">Stock</th>
                                    <th className="p-3 text-right">Low Stock</th>
                                    <th className="p-3 text-right">Critical Level</th>
                                    <th className="p-3 text-center">Stock Status</th>
                                    <th className="p-3 text-center">Expiry Status</th>
                                            <th className="p-3 text-left">Production Date</th>
                                    <th className="p-3 text-left">Expiry Date</th>
                                    <th className="p-3 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStocks.map((stk) => {
                                                const expiryStatus = stk.expiryDate ? getExpiryStatus(stk.expiryDate) : { status: 'N/A', className: 'bg-gray-100 text-gray-800' };
                                    const stockValue = stk.type === 'fixed' ? (stk.quantity || 0) : (stk.bilao || 0);
                                    const stockLabel = stk.type === 'fixed' ? 'pieces' : 'bilao';
                                    const productName = stk.type === 'fixed' ? `${stk.variety} (${stk.size})` : stk.variety;
                                    const displayType = stk.type === 'fixed' 
                                        ? (stk.size ? stk.size.charAt(0).toUpperCase() + stk.size.slice(1) : 'Unknown')
                                        : 'Bilao';
                                    
                                    return (
                                        <tr key={stk.id} className="border-t hover:bg-gray-50">
                                            <td className="p-3">{productName}</td>
                                            <td className="p-3">{displayType}</td>
                                            <td className="p-3 text-right">
                                                {stk.type === 'fixed' ? 
                                                    `${stockValue} ${stockLabel}` :
                                                    `${stockValue.toFixed(2)} ${stockLabel}`}
                                                <button
                                                    onClick={() => handleAddStock(stk)}
                                                    className="ml-2 px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                                                    title="Add Stock"
                                                >
                                                    +
                                                </button>
                                            </td>
                                                        <td className="p-3 text-right">{stk.minimumStock}</td>
                                            <td className="p-3 text-right">{stk.criticalLevel}</td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                    stockValue <= stk.minimumStock
                                                        ? 'bg-red-100 text-red-800'
                                                        : stockValue <= stk.criticalLevel
                                                        ? 'bg-yellow-100 text-yellow-800'
                                                        : 'bg-green-100 text-green-800'
                                                }`}>
                                                    {stockValue <= stk.minimumStock
                                                        ? 'Low Stock'
                                                        : stockValue <= stk.criticalLevel
                                                        ? 'Reorder Soon'
                                                        : 'In Stock'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs ${expiryStatus.className}`}>
                                                    {expiryStatus.status}
                                                </span>
                                            </td>
                                                        <td className="p-3">{formatDate(stk.productionDate)}</td>
                                                        <td className="p-3">{formatDate(stk.expiryDate)}</td>
                                            <td className="p-3">
                                                <div className="flex justify-center">
                                                    <button
                                                        onClick={() => handleDelete(stk.id, stk.type)}
                                                        className="p-1 hover:bg-gray-100 rounded"
                                                        title="Delete"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Stock History */}
                <div className="bg-white p-6 rounded-lg shadow-md mt-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">Stock History</h2>
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className="text-blue-600 hover:text-blue-800"
                        >
                            {showHistory ? 'Hide History' : 'Show History'}
                        </button>
                    </div>
                    {showHistory && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead>
                                    <tr className="bg-gray-50">
                                        <th className="p-3 text-left">Date</th>
                                        <th className="p-3 text-left">Product</th>
                                        <th className="p-3 text-center">Type</th>
                                        <th className="p-3 text-right">Previous</th>
                                        <th className="p-3 text-right">Change</th>
                                        <th className="p-3 text-right">New</th>
                                        <th className="p-3 text-left">Updated By</th>
                                        <th className="p-3 text-left">Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockHistory.map((history) => {
                                        const isFixedSize = history.size !== undefined;
                                        const previousValue = isFixedSize ? history.previousQuantity : history.previousBilao;
                                        const changeValue = isFixedSize ? history.quantity : history.bilao;
                                        const newValue = isFixedSize ? history.newQuantity : history.newBilao;
                                        const unit = isFixedSize ? 'pieces' : 'bilao';
                                        
                                        return (
                                        <tr key={history.id} className="border-t hover:bg-gray-50">
                                            <td className="p-3">{history.date.toLocaleDateString()}</td>
                                                <td className="p-3">{history.variety}{history.size ? ` (${history.size})` : ''}</td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                    history.type === 'in' ? 'bg-green-100 text-green-800' :
                                                    history.type === 'out' ? 'bg-red-100 text-red-800' :
                                                    'bg-yellow-100 text-yellow-800'
                                                }`}>
                                                    {history.type === 'in' ? 'Stock In' :
                                                     history.type === 'out' ? 'Stock Out' :
                                                     'Adjustment'}
                                                </span>
                                            </td>
                                                <td className="p-3 text-right">{previousValue} {unit}</td>
                                                <td className="p-3 text-right">{changeValue} {unit}</td>
                                                <td className="p-3 text-right">{newValue} {unit}</td>
                                            <td className="p-3">{history.updatedBy}</td>
                                            <td className="p-3">{history.remarks}</td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    );
}
