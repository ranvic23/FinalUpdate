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

const SIZES = [
    'Big Bilao',
    'Tray',
    'Half Tray',
    'Small',
    'Solo',
    '1/4'
];

const VARIETIES = [
    'Bibingka',
    'Sapin-Sapin',
    'Kutsinta',
    'Kalamay',
    'Cassava'
];

// Define size configurations with specific rules
const sizeConfigs: Size[] = [
    {
        id: '1',
        name: 'Big Bilao',
        price: 520.00,
        maxVarieties: 4,
        minVarieties: 1,
        totalSlices: 60,
        excludedVarieties: ['Cassava'],
        description: 'Can have up to 4 varieties (no Cassava)'
    },
    {
        id: '2',
        name: 'Tray',
        price: 420.00,
        maxVarieties: 4,
        minVarieties: 1,
        totalSlices: 48,
        description: 'Can have up to 4 varieties'
    },
    {
        id: '3',
        name: 'Small',
        price: 280.00,
        maxVarieties: 1,
        minVarieties: 1,
        totalSlices: 30,
        allowedVarieties: ['Bibingka'],
        description: 'Bibingka only'
    },
    {
        id: '4',
        name: 'Half Tray',
        price: 240.00,
        maxVarieties: 2,
        minVarieties: 1,
        totalSlices: 24,
        description: 'Can have up to 2 varieties'
    },
    {
        id: '5',
        name: 'Solo',
        price: 200.00,
        maxVarieties: 1,
        minVarieties: 1,
        totalSlices: 20,
        allowedVarieties: ['Bibingka'],
        description: 'Bibingka only'
    },
    {
        id: '6',
        name: '1/4 Slice',
        price: 140.00,
        maxVarieties: 5,
        minVarieties: 1,
        totalSlices: 12,
        boxPrice: 140.00,
        description: 'Can have up to 5 varieties'
    }
];

interface VarietyCombination {
    varieties: string[];
    quantity: number;
}

interface Size {
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

interface Stock {
    id: string;
    type: 'size' | 'variety';
    size: string;
    variety?: string;
    slices: number;
    quantity?: number;
    minimumStock: number;
    criticalLevel: number;
    minimumSlices?: number;
    criticalSlices?: number;
    totalSlices?: number;
    combinations?: VarietyCombination[];
    productionDate?: string;
    expiryDate?: string;
    lastUpdated?: string;
}

interface StockHistory {
    id: string;
    stockId: string;
    size: string;
    variety: string;
    type: 'in' | 'out' | 'adjustment' | 'deleted';
    slices: number;
    previousSlices: number;
    newSlices: number;
    date: Date;
    updatedBy: string;
    remarks: string;
    isDeleted: boolean;
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
    size: string;
    varieties: string[];
    quantity: number;
}

// Move the function outside and before the Stock component
export const restoreStockOnCancel = async (orderDetails: OrderDetails) => {
    try {
        // Get the size configuration for the order
        const sizeConfig = sizeConfigs.find(size => size.name === orderDetails.size);
        if (!sizeConfig) {
            throw new Error(`Size configuration not found for ${orderDetails.size}`);
        }

        // Restore size stock - handle "Half Tray" case
        const sizeDocId = orderDetails.size === "Half Tray" ? "Half Tray" : orderDetails.size;
        const sizeStockRef = doc(db, "sizeStocks", sizeDocId);
        const sizeStockDoc = await getDoc(sizeStockRef);
        
        if (sizeStockDoc.exists()) {
            const sizeStock = sizeStockDoc.data() as Stock;
            // Restore exactly what was deducted (in boxes/trays)
            const newSizeSlices = (sizeStock.slices || 0) + orderDetails.quantity;
            
            // Update the size stock
            await updateDoc(sizeStockRef, {
                slices: newSizeSlices,
                lastUpdated: new Date().toISOString()
            });

            // Add to stock history for size stock
            const sizeHistoryRef = collection(db, "stockHistory");
            await addDoc(sizeHistoryRef, {
                stockId: sizeDocId,
                size: orderDetails.size,
                variety: '',
                type: 'in',
                slices: orderDetails.quantity,
                previousSlices: sizeStock.slices || 0,
                newSlices: newSizeSlices,
                date: new Date(),
                updatedBy: "System",
                remarks: `Order cancelled - Restored ${orderDetails.quantity} boxes/trays to ${orderDetails.size}`,
                isDeleted: false
            });
        } else {
            console.error(`Size stock not found for ${orderDetails.size}`);
            throw new Error(`Size stock not found for ${orderDetails.size}`);
        }

        // Calculate slices per variety that need to be restored
        const slicesPerVariety = Math.floor(sizeConfig.totalSlices / orderDetails.varieties.length);
        const varietySlicesToRestore = slicesPerVariety * orderDetails.quantity;

        // Restore variety stocks
        for (const variety of orderDetails.varieties) {
            // Get all variety stocks
            const varietyStockRef = collection(db, "varietyStocks");
            const varietySnapshot = await getDocs(varietyStockRef);
            
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
                const newVarietySlices = (varietyData.slices || 0) + varietySlicesToRestore;

                await updateDoc(latestStock.ref, {
                    slices: newVarietySlices,
                    lastUpdated: new Date().toISOString()
                });

                // Add to stock history for variety stock
                const varietyHistoryRef = collection(db, "stockHistory");
                await addDoc(varietyHistoryRef, {
                    stockId: latestStock.id,
                    variety: variety,
                    type: 'in',
                    slices: varietySlicesToRestore,
                    previousSlices: varietyData.slices || 0,
                    newSlices: newVarietySlices,
                    date: new Date(),
                    updatedBy: "System",
                    remarks: `Order cancelled - Restored ${varietySlicesToRestore} slices to ${variety}`,
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
        // Get the size configuration for the order
        const sizeConfig = sizeConfigs.find(size => size.name === orderDetails.size);
        if (!sizeConfig) {
            throw new Error(`Size configuration not found for ${orderDetails.size}`);
        }

        // Calculate slices per variety
        const slicesPerVariety = Math.floor(sizeConfig.totalSlices / orderDetails.varieties.length);

        // Update size stock
        const sizeStockRef = doc(db, "sizeStocks", orderDetails.size);
        const sizeStockDoc = await getDoc(sizeStockRef);
        
        if (!sizeStockDoc.exists()) {
            throw new Error(`Size stock not found for ${orderDetails.size}`);
        }

        const sizeStock = sizeStockDoc.data() as Stock;
        if ((sizeStock.slices || 0) < orderDetails.quantity) {
            throw new Error(`Insufficient ${orderDetails.size} stock. Available: ${sizeStock.slices}, Needed: ${orderDetails.quantity}`);
        }

        // Calculate total slices needed per variety
        const slicesNeededPerVariety = slicesPerVariety * orderDetails.quantity;

        // Check and update variety stocks (prioritizing earlier production dates)
        for (const variety of orderDetails.varieties) {
            let remainingSlicesToDeduct = slicesNeededPerVariety;
            
            // Get all variety stocks ordered by production date (earliest first)
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

            // Calculate total available slices
            const totalAvailableSlices = varietyStocks.reduce((sum, doc) => 
                sum + ((doc.data() as Stock).slices || 0), 0);

            if (totalAvailableSlices < slicesNeededPerVariety) {
                throw new Error(`Insufficient slices for variety: ${variety}. Available: ${totalAvailableSlices}, Needed: ${slicesNeededPerVariety}`);
            }

            // Deduct from stocks starting with earliest production date
            for (const varietyDoc of varietyStocks) {
                if (remainingSlicesToDeduct <= 0) break;

                const varietyStock = varietyDoc.data() as Stock;
                const currentSlices = varietyStock.slices || 0;
                const slicesToDeduct = Math.min(remainingSlicesToDeduct, currentSlices);
                const newSlices = currentSlices - slicesToDeduct;

                await updateDoc(varietyDoc.ref, {
                    slices: newSlices,
                    lastUpdated: new Date().toISOString()
                });

                // Record variety stock history
                await addDoc(collection(db, "stockHistory"), {
                    stockId: varietyDoc.id,
                    variety: variety,
                    type: 'out',
                    slices: slicesToDeduct,
                    previousSlices: currentSlices,
                    newSlices: newSlices,
                    date: new Date(),
                    updatedBy: "Order System",
                    remarks: `Order pickup - Order ID: ${orderDetails.orderId} - Deducted ${slicesToDeduct} slices`,
                    isDeleted: false,
                    productionDate: varietyStock.productionDate,
                    expiryDate: varietyStock.expiryDate
                });

                remainingSlicesToDeduct -= slicesToDeduct;
            }
        }

        // Update size stock after all variety stocks are successfully updated
        const newSizeSlices = (sizeStock.slices || 0) - orderDetails.quantity;
        const newSizeQuantity = (sizeStock.quantity || 0) - orderDetails.quantity;
        await updateDoc(sizeStockRef, {
            slices: newSizeSlices,
            quantity: newSizeQuantity,
            lastUpdated: new Date().toISOString()
        });

        // Record size stock history
        await addDoc(collection(db, "stockHistory"), {
            stockId: orderDetails.size,
            size: orderDetails.size,
            variety: '',
            type: 'out',
            slices: orderDetails.quantity,
            quantity: orderDetails.quantity,
            previousSlices: sizeStock.slices || 0,
            newSlices: newSizeSlices,
            previousQuantity: sizeStock.quantity || 0,
            newQuantity: newSizeQuantity,
            date: new Date(),
            updatedBy: "Order System",
            remarks: `Order pickup - Order ID: ${orderDetails.orderId} - Deducted ${orderDetails.quantity} ${orderDetails.size}`,
            isDeleted: false
        });

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

export default function Stock() {
    const [stocks, setStocks] = useState<Stock[]>([]);
    const [stockHistory, setStockHistory] = useState<StockHistory[]>([]);
    
    // Separate states for size and variety stocks
    const [sizeStock, setSizeStock] = useState<Stock>({
        id: '',
        type: 'size',
        size: '',
        slices: 0,
        minimumStock: 0,
        criticalLevel: 0,
        lastUpdated: new Date().toISOString()
    });

    const [varietyStock, setVarietyStock] = useState<Stock>({
        id: '',
        type: 'variety',
        size: '',
        variety: '',
        slices: 0,
        minimumStock: 0,
        criticalLevel: 0,
        productionDate: '',
        expiryDate: '',
        lastUpdated: new Date().toISOString()
    });

    const [editStockId, setEditStockId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [filterCategory, setFilterCategory] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [showLowStock, setShowLowStock] = useState(false);
    const [sizes, setSizes] = useState<Size[]>(sizeConfigs);
    const [selectedVarieties, setSelectedVarieties] = useState<string[]>([]);
    const [isAddSizeOrVarietyOpen, setIsAddSizeOrVarietyOpen] = useState(false);
    const [isAddSizeOpen, setIsAddSizeOpen] = useState(false);
    const [isAddVarietyOpen, setIsAddVarietyOpen] = useState(false);
    const [newSizeName, setNewSizeName] = useState('');
    const [newSizePrice, setNewSizePrice] = useState('');
    const [newSizeMaxVarieties, setNewSizeMaxVarieties] = useState('1');
    const [newVarietyName, setNewVarietyName] = useState('');
    const [varieties, setVarieties] = useState<{ id: string; name: string }[]>([]);
    const [currentCombination, setCurrentCombination] = useState<VarietyCombination>({
        varieties: [],
        quantity: 0
    });
    const [stockChartData, setStockChartData] = useState<ChartData>({
        labels: [],
        datasets: [{
            label: 'Stock Level',
            data: [],
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
            tension: 0.1
        }]
    });

    const [filterType, setFilterType] = useState<'all' | 'size' | 'variety'>('all');

    useEffect(() => {
        fetchSizes();
        fetchStocks();
        fetchStockHistory();
        fetchVarieties();
    }, []);

    const fetchStocks = async () => {
        try {
            // Fetch size stocks
            const sizeStocksRef = collection(db, "sizeStocks");
            const sizeSnapshot = await getDocs(sizeStocksRef);
            const sizeStocks = sizeSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Stock[];

            // Fetch variety stocks ordered by production date
            const varietyStocksRef = collection(db, "varietyStocks");
            const varietyQuery = query(varietyStocksRef, orderBy("productionDate", "asc"));
            const varietySnapshot = await getDocs(varietyQuery);
            const varietyStocks = varietySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Stock[];

            setStocks([...sizeStocks, ...varietyStocks]);
            updateStockChart([...sizeStocks, ...varietyStocks]);
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

    const fetchSizes = async () => {
        try {
            const querySnapshot = await getDocs(collection(db, "sizes"));
            const sizesList = querySnapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name,
                price: doc.data().price,
                maxVarieties: doc.data().maxVarieties
            })) as Size[];
            setSizes(sizesList);
        } catch (error) {
            console.error("Error fetching sizes:", error);
        }
    };

    const fetchVarieties = async () => {
        try {
            const querySnapshot = await getDocs(collection(db, "varieties"));
            const varietiesList = querySnapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name
            }));
            console.log("Fetched varieties:", varietiesList);
            setVarieties(varietiesList);
        } catch (error) {
            console.error("Error fetching varieties:", error);
        }
    };

    const updateStockChart = (stockData: Stock[]) => {
        const labels: string[] = [];
        const quantities: number[] = [];
        const minimums: number[] = [];
        const criticalLevels: number[] = [];

        stockData.forEach(stock => {
            if (stock.type === 'size' && stock.combinations && stock.combinations.length > 0) {
                // For stocks with combinations
                stock.combinations.forEach(combo => {
                    const varietyLabel = combo.varieties?.join('/') || 'N/A';
                    const label = `${stock.size} - ${varietyLabel}`;
                    labels.push(label);
                    quantities.push(combo.quantity);
                    minimums.push(stock.minimumStock);
                    criticalLevels.push(stock.criticalLevel);
                });
            } else {
                // For regular stocks
                const label = stock.variety ? `${stock.size} - ${stock.variety}` : stock.size;
                labels.push(label);
                quantities.push(stock.slices);
                minimums.push(stock.minimumStock);
                criticalLevels.push(stock.criticalLevel);
            }
        });

        setStockChartData({
            labels,
            datasets: [
                {
                    label: 'Current Stock',
                    data: quantities,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                tension: 0.1
                },
                {
                    label: 'Minimum Stock',
                    data: minimums,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.5)',
                    tension: 0.1
                },
                {
                    label: 'Critical Level',
                    data: criticalLevels,
                    borderColor: 'rgb(255, 205, 86)',
                    backgroundColor: 'rgba(255, 205, 86, 0.5)',
                    tension: 0.1
                }
            ]
        });
    };

    const handleSubmitSizeStock = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const selectedSize = (document.getElementById("size") as HTMLSelectElement).value;
            const quantity = parseInt((document.getElementById("quantity") as HTMLInputElement).value);
            const minimumStock = parseInt((document.getElementById("minimumStock") as HTMLInputElement).value);
            const criticalLevel = parseInt((document.getElementById("criticalLevel") as HTMLInputElement).value);
            
            if (!selectedSize || isNaN(quantity) || quantity <= 0) {
                alert("Please select a size and enter a valid quantity");
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

            // Get size configuration
            const sizeConfig = sizeConfigs.find(config => config.name === selectedSize);
            if (!sizeConfig) {
                alert("Size configuration not found");
                return;
            }

            // Use setDoc with size name as document ID
            const sizeStockRef = doc(db, "sizeStocks", selectedSize);
            const sizeStockDoc = await getDoc(sizeStockRef);
            
            if (sizeStockDoc.exists()) {
                // Update existing stock
                const currentStock = sizeStockDoc.data() as Stock;
                const newQuantity = (currentStock.quantity || 0) + quantity;
                const newSlices = newQuantity; // Don't multiply by slices per box

                await updateDoc(sizeStockRef, {
                    slices: newSlices,
                    quantity: newQuantity,
                    minimumStock,
                    criticalLevel,
                    lastUpdated: new Date().toISOString()
                });

                // Add to stock history
                const historyRef = collection(db, "stockHistory");
                await addDoc(historyRef, {
                    stockId: selectedSize,
                    size: selectedSize,
                    variety: "",
                    type: "in",
                    slices: quantity,
                    quantity: quantity,
                    previousSlices: currentStock.slices,
                    newSlices: newSlices,
                    previousQuantity: currentStock.quantity || 0,
                    newQuantity: newQuantity,
                    date: new Date(),
                    updatedBy: "System",
                    remarks: `Added ${quantity} ${selectedSize} boxes/trays`,
                    isDeleted: false
            });
        } else {
                // Create new stock
                await setDoc(sizeStockRef, {
                    type: "size",
                    size: selectedSize,
                    slices: quantity, // Don't multiply by slices per box
                    quantity: quantity,
                    minimumStock,
                    criticalLevel,
                    lastUpdated: new Date().toISOString()
                });

                // Add to stock history
                const historyRef = collection(db, "stockHistory");
                await addDoc(historyRef, {
                    stockId: selectedSize,
                    size: selectedSize,
                    variety: "",
                    type: "in",
                    slices: quantity,
                    quantity: quantity,
                    previousSlices: 0,
                    newSlices: quantity,
                    previousQuantity: 0,
                    newQuantity: quantity,
                    date: new Date(),
                    updatedBy: "System",
                    remarks: `Initial stock: ${quantity} ${selectedSize} boxes/trays`,
                    isDeleted: false
                });
            }

            // Reset form and refresh stocks
            resetForm();
            fetchStocks();
            toast.success("Size stock updated successfully");
        } catch (error) {
            console.error("Error submitting size stock:", error);
            toast.error("Failed to update size stock");
        }
    };

    const handleSubmitVarietyStock = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const selectedVariety = (document.getElementById("variety") as HTMLSelectElement).value;
            const slices = parseInt((document.getElementById("varietySlices") as HTMLInputElement).value);
            const minimumStock = parseInt((document.getElementById("varietyMinimumStock") as HTMLInputElement).value);
            const criticalLevel = parseInt((document.getElementById("varietyCriticalLevel") as HTMLInputElement).value);
            const productionDate = (document.getElementById("productionDate") as HTMLInputElement).value;
            const expiryDate = (document.getElementById("expiryDate") as HTMLInputElement).value;

            if (!selectedVariety || isNaN(slices) || slices <= 0) {
                alert("Please select a variety and enter a valid number of slices");
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
                alert("Invalid variety selected");
                return;
            }

            // Create a new variety stock batch
            const varietyStockRef = collection(db, "varietyStocks");
            const docRef = await addDoc(varietyStockRef, {
                type: "variety",
                variety: exactVarietyName, // Use the exact variety name from the constant
                slices,
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
                variety: exactVarietyName, // Use the exact variety name from the constant
                type: "in",
                slices,
                previousSlices: 0,
                newSlices: slices,
                date: new Date(),
                updatedBy: "System",
                remarks: `Added new batch of ${slices} slices for ${exactVarietyName}`,
                isDeleted: false,
                productionDate,
                expiryDate
            });

            resetForm();
            fetchStocks();
            toast.success("Variety stock added successfully");
        } catch (error) {
            console.error("Error submitting variety stock:", error);
            toast.error("Failed to add variety stock");
        }
    };

    const handleStockAdjustment = async (id: string, adjustment: number) => {
        try {
            const stockRef = doc(db, "stocks", id);
            const currentStock = stocks.find(s => s.id === id);
            
            if (!currentStock) {
                alert("Stock not found!");
                return;
            }

            const newSlices = currentStock.slices + adjustment;
            if (newSlices < 0) {
                alert("Stock cannot be negative!");
                return;
            }

            const timestamp = new Date();
            
            await updateDoc(stockRef, {
                slices: newSlices,
                lastUpdated: timestamp.toISOString()
            });

            await addDoc(collection(db, "stockHistory"), {
                stockId: id,
                size: currentStock.size,
                variety: currentStock.variety,
                type: adjustment > 0 ? 'in' : 'out',
                slices: Math.abs(adjustment),
                previousSlices: currentStock.slices,
                newSlices: newSlices,
                date: timestamp,
                updatedBy: "Admin",
                remarks: `Stock ${adjustment > 0 ? 'added' : 'removed'}: ${Math.abs(adjustment)} slices`,
                isDeleted: false
            });

            await Promise.all([fetchStocks(), fetchStockHistory()]);
            alert(`Stock ${adjustment > 0 ? 'added' : 'removed'} successfully!`);
        } catch (error) {
            console.error("Error adjusting stock:", error);
            alert("Failed to adjust stock. Please try again later.");
        }
    };

    const handleDelete = async (id: string, type: 'size' | 'variety') => {
        if (!confirm("Are you sure you want to delete this stock?")) {
            return;
        }

        try {
            const collectionName = type === 'size' ? "sizeStocks" : "varietyStocks";
            const stockRef = doc(db, collectionName, id);
            const stockDoc = await getDoc(stockRef);
            
            if (!stockDoc.exists()) {
                alert("Stock not found!");
                return;
            }

            const stockData = stockDoc.data();

            await deleteDoc(stockRef);

            await addDoc(collection(db, "stockHistory"), {
                stockId: id,
                size: type === 'size' ? stockData.size : '',
                variety: type === 'variety' ? stockData.variety : '',
                type: 'deleted',
                slices: stockData.slices,
                previousSlices: stockData.slices,
                newSlices: 0,
                date: new Date(),
                updatedBy: "Admin",
                remarks: `${type === 'size' ? 'Size' : 'Variety'} stock deleted`,
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
        setSizeStock({
            id: '',
            type: 'size',
            size: '',
            slices: 0,
            minimumStock: 0,
            criticalLevel: 0,
            lastUpdated: new Date().toISOString()
        });
        setVarietyStock({
            id: '',
            type: 'variety',
            size: '',
            variety: '',
            slices: 0,
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
        if (stk.type === 'size') {
            setSizeStock(stk);
        } else {
            setVarietyStock(stk);
        }
    };

    const filteredStocks = stocks
        .filter(s => filterType === 'all' || s.type === filterType)
        .filter(s => filterCategory === 'all' || s.size === filterCategory)
        .filter(s => showLowStock ? s.slices <= s.minimumStock : true)
        .filter(s => !searchTerm || (s.variety?.toLowerCase() ?? '').includes(searchTerm.toLowerCase()));

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
            },
            title: {
                display: true,
                text: 'Stock Levels Overview'
            },
        },
    };

    const handleVarietyChange = (selectedVarieties: string[]) => {
        const selectedSize = sizes.find(s => s.id === sizeStock.size);
        if (!selectedSize) return;

        // Validate against size constraints
        if (selectedVarieties.length > selectedSize.maxVarieties) {
            alert(`${selectedSize.name} can only have up to ${selectedSize.maxVarieties} varieties`);
            return;
        }

        // Check for allowed varieties
        if (selectedSize.allowedVarieties && 
            selectedVarieties.some(v => !selectedSize.allowedVarieties?.includes(v))) {
            alert(`Only ${selectedSize.allowedVarieties.join(', ')} allowed for ${selectedSize.name}`);
            return;
        }

        // Check for excluded varieties
        if (selectedSize.excludedVarieties && 
            selectedVarieties.some(v => selectedSize.excludedVarieties?.includes(v))) {
            alert(`${selectedSize.excludedVarieties.join(', ')} not allowed for ${selectedSize.name}`);
            return;
        }

        setCurrentCombination(prev => ({
            ...prev,
            varieties: selectedVarieties
        }));
    };

    const handleAddCombination = () => {
        if (currentCombination.varieties.length === 0) {
            alert('Please select at least one variety');
            return;
        }

        if (currentCombination.quantity <= 0) {
            alert('Please enter a valid quantity');
            return;
        }

        const selectedSize = sizes.find(s => s.id === sizeStock.size);
        if (!selectedSize) return;

        // Check if this combination would exceed maximum varieties
        const existingVarieties = new Set(sizeStock.combinations?.flatMap(c => c.varieties) ?? []);
        const newVarieties = new Set([...existingVarieties, ...currentCombination.varieties]);
        
        if (newVarieties.size > selectedSize.maxVarieties) {
            alert(`${selectedSize.name} can only have ${selectedSize.maxVarieties} different varieties in total`);
            return;
        }

        setSizeStock(prev => {
            const newCombinations = [...(prev.combinations ?? []), currentCombination];
            const newTotalSlices = newCombinations.reduce((sum, c) => sum + c.quantity, 0);
            
            return {
                ...prev,
                combinations: newCombinations,
                slices: newTotalSlices
            };
        });

        // Reset current combination
        setCurrentCombination({
            varieties: [],
            quantity: 0
        });
    };

    const handleAddSize = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (!newSizeName || !newSizePrice) {
                alert('Please fill in all size fields');
                return;
            }

                await addDoc(collection(db, "sizes"), {
                    name: newSizeName,
                    price: parseFloat(newSizePrice),
                    maxVarieties: parseInt(newSizeMaxVarieties),
                    createdAt: new Date()
                });
            
                setNewSizeName('');
                setNewSizePrice('');
                setNewSizeMaxVarieties('1');
            await fetchSizes();
            alert("Successfully added new size!");
            setIsAddSizeOpen(false);
        } catch (error) {
            console.error("Error adding size:", error);
            alert("Failed to add size");
        }
    };

    const handleAddVariety = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (!newVarietyName) {
                alert('Please enter a variety name');
                return;
            }

                await addDoc(collection(db, "varieties"), {
                    name: newVarietyName,
                    createdAt: new Date()
                });
            
            setNewVarietyName('');
            await fetchVarieties();
            alert("Successfully added new variety!");
            setIsAddVarietyOpen(false);
        } catch (error) {
            console.error("Error adding variety:", error);
            alert("Failed to add variety");
        }
    };

    // Add these functions to handle deletion
    const handleDeleteSize = async (sizeId: string) => {
        if (!confirm('Are you sure you want to delete this size?')) return;
        try {
            await deleteDoc(doc(db, "sizes", sizeId));
            await fetchSizes();
            alert('Size deleted successfully!');
        } catch (error) {
            console.error("Error deleting size:", error);
            alert('Failed to delete size');
        }
    };

    const handleDeleteVariety = async (varietyId: string) => {
        if (!confirm('Are you sure you want to delete this variety?')) return;
        try {
            await deleteDoc(doc(db, "varieties", varietyId));
            await fetchVarieties();
            alert('Variety deleted successfully!');
        } catch (error) {
            console.error("Error deleting variety:", error);
            alert('Failed to delete variety');
        }
    };

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

    // Function to handle stock deduction
    const handleStockDeduction = async (variety: string, slicesNeeded: number) => {
        try {
            const varietyStocksRef = collection(db, "varietyStocks");
            const varietyQuery = query(
                varietyStocksRef,
                where("variety", "==", variety),
                orderBy("productionDate", "asc")
            );
            const varietySnapshot = await getDocs(varietyQuery);
            
            let remainingSlices = slicesNeeded;
            const updates = [];
            
            for (const doc of varietySnapshot.docs) {
                if (remainingSlices <= 0) break;
                
                const stockData = doc.data() as Stock;
                const availableSlices = stockData.slices;
                
                if (availableSlices > 0) {
                    const slicesToDeduct = Math.min(remainingSlices, availableSlices);
                    const newSlices = availableSlices - slicesToDeduct;
                    
                    updates.push({
                        ref: doc.ref,
                        previousSlices: availableSlices,
                        newSlices: newSlices,
                        deducted: slicesToDeduct
                    });
                    
                    remainingSlices -= slicesToDeduct;
                }
            }
            
            if (remainingSlices > 0) {
                throw new Error(`Insufficient stock for ${variety}: needed ${slicesNeeded}, short by ${remainingSlices}`);
            }
            
            // Apply updates and create history records
            for (const update of updates) {
                await updateDoc(update.ref, {
                    slices: update.newSlices,
                    lastUpdated: new Date().toISOString()
                });
                
            await addDoc(collection(db, "stockHistory"), {
                    stockId: update.ref.id,
                    variety,
                    type: "out",
                    slices: update.deducted,
                    previousSlices: update.previousSlices,
                    newSlices: update.newSlices,
                date: new Date(),
                    updatedBy: "System",
                    remarks: `Deducted ${update.deducted} slices`,
                isDeleted: false
            });
            }
            
            return true;
        } catch (error) {
            console.error("Error deducting stock:", error);
            throw error;
        }
    };

    const handleAddQuantity = async (sizeId: string, currentSize: string) => {
        const quantity = prompt("Enter number of slices to add:");
        if (!quantity) return;

        const numQuantity = parseInt(quantity);
        if (isNaN(numQuantity) || numQuantity <= 0) {
            alert("Please enter a valid positive number");
            return;
        }

        try {
            const sizeStockRef = doc(db, "sizeStocks", sizeId);
            const sizeStockDoc = await getDoc(sizeStockRef);
            
            if (sizeStockDoc.exists()) {
                const currentStock = sizeStockDoc.data() as Stock;
                // Simply add the input quantity to existing slices
                const newSlices = (currentStock.slices || 0) + numQuantity;

                await updateDoc(sizeStockRef, {
                    slices: newSlices,
                    lastUpdated: new Date().toISOString()
                });

                // Add to stock history
                const historyRef = collection(db, "stockHistory");
                await addDoc(historyRef, {
                    stockId: sizeId,
                    size: currentSize,
                    variety: "",
                    type: "in",
                    slices: numQuantity,
                    previousSlices: currentStock.slices || 0,
                    newSlices: newSlices,
                    date: new Date(),
                    updatedBy: "System",
                    remarks: `Added ${numQuantity} slices to ${currentSize}`,
                    isDeleted: false
                });

                await fetchStocks();
                toast.success(`Successfully added ${numQuantity} slices`);
            } else {
                toast.error("Stock entry not found");
            }
        } catch (error) {
            console.error("Error adding quantity:", error);
            toast.error("Failed to update stock quantity");
        }
    };

    return (
        <ProtectedRoute>
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-2xl font-bold mb-6">Stock Management</h1>
                
                <div className="flex justify-end space-x-2 mb-4">
                    <button
                        onClick={() => setIsAddSizeOpen(true)}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                        Add New Size
                    </button>
                    <button
                        onClick={() => setIsAddVarietyOpen(true)}
                        className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                    >
                        Add New Variety
                    </button>
                </div>

                {/* Size-based Stock Form */}
                <div className="mb-8 p-4 bg-gray-50 rounded">
                    <h3 className="text-lg font-semibold mb-4">Add Size Stock</h3>
                    <form onSubmit={handleSubmitSizeStock} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                <label className="block text-sm font-medium mb-2">Select Size</label>
                                    <select
                                    id="size"
                                        className="w-full p-2 border rounded"
                                    value={sizeStock.size}
                                    onChange={(e) => setSizeStock(prev => ({ ...prev, size: e.target.value }))}
                                    required
                                >
                                    <option value="">Select Size...</option>
                                    {sizeConfigs.map(size => (
                                        <option key={size.id} value={size.name}>
                                            {size.name} ({size.totalSlices} slices)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                <label className="block text-sm font-medium mb-2">Number of Boxes/Trays</label>
                                    <input
                                    id="quantity"
                                        type="number"
                                        className="w-full p-2 border rounded"
                                    value={sizeStock.slices}
                                    onChange={(e) => setSizeStock(prev => ({ ...prev, slices: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                    />
                                </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Low Stock Level (Boxes/Trays)</label>
                                <input
                                    id="minimumStock"
                                    type="number"
                                    className="w-full p-2 border rounded"
                                    value={sizeStock.minimumStock}
                                    onChange={(e) => setSizeStock(prev => ({ ...prev, minimumStock: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Critical Level (Boxes/Trays)</label>
                                <input
                                    id="criticalLevel"
                                    type="number"
                                    className="w-full p-2 border rounded"
                                    value={sizeStock.criticalLevel}
                                    onChange={(e) => setSizeStock(prev => ({ ...prev, criticalLevel: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                />
                        </div>

                            {sizeStock.size && (
                                <div className="col-span-2">
                                    <div className="space-y-2 text-sm text-gray-600">
                                        <p>Total Slices: {
                                            (sizeStock.slices || 0) * 
                                            (sizeConfigs.find(s => s.name === sizeStock.size)?.totalSlices || 0)
                                        } slices</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end">
                                            <button
                                type="submit"
                                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                disabled={loading}
                            >
                                {loading ? 'Adding...' : 'Add Size Stock'}
                                            </button>
                                        </div>
                    </form>
                </div>

                {/* Variety-based Stock Form */}
                <div className="p-4 bg-gray-50 rounded mb-8">
                    <h3 className="text-lg font-semibold mb-4">Add Variety Stock</h3>
                    <form onSubmit={handleSubmitVarietyStock} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Variety</label>
                                <select
                                    className="w-full p-2 border rounded"
                                    value={varietyStock.variety}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, variety: e.target.value }))}
                                    required
                                >
                                    <option value="">Select Variety...</option>
                                    {varieties.map(variety => (
                                        <option key={variety.id} value={variety.name}>{variety.name}</option>
                                    ))}
                                </select>
                                    </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Slices</label>
                                <input
                                    type="number"
                                    className="w-full p-2 border rounded"
                                    value={varietyStock.slices}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, slices: parseInt(e.target.value) || 0 }))}
                                    min="0"
                                    required
                                />
                                </div>

                                <div>
                                <label className="block text-sm font-medium mb-2">Low Stock Level (Slices)</label>
                                    <input
                                        type="number"
                                        className="w-full p-2 border rounded"
                                    value={varietyStock.minimumStock}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, minimumStock: parseInt(e.target.value) || 0 }))}
                                        min="0"
                                    required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-2">Critical Level (Slices)</label>
                                    <input
                                        type="number"
                                        className="w-full p-2 border rounded"
                                    value={varietyStock.criticalLevel}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, criticalLevel: parseInt(e.target.value) || 0 }))}
                                        min="0"
                                    required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-2">Production Date</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border rounded"
                                    value={varietyStock.productionDate}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, productionDate: e.target.value }))}
                                    required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-2">Expiry Date</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border rounded"
                                    value={varietyStock.expiryDate}
                                    onChange={(e) => setVarietyStock(prev => ({ ...prev, expiryDate: e.target.value }))}
                                    required
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
                                disabled={loading}
                            >
                                {loading ? 'Adding...' : 'Add Variety Stock'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Stock List */}
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold mb-4">Stock List</h2>
                    
                    {/* Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <select
                            className="p-2 border rounded"
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value as 'all' | 'size' | 'variety')}
                        >
                            <option value="all">All Types</option>
                            <option value="size">Size Stocks</option>
                            <option value="variety">Variety Stocks</option>
                        </select>

                        <select
                            className="p-2 border rounded"
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                        >
                            <option value="all">All Sizes</option>
                            {sizes.map(size => (
                                <option key={size.id} value={size.name}>{size.name}</option>
                            ))}
                        </select>

                        <input
                            type="text"
                            placeholder="Search by variety..."
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

                    {/* Size Stock Table */}
                    {(filterType === 'all' || filterType === 'size') && (
                        <>
                            <h3 className="text-lg font-semibold mb-2">Size Stocks</h3>
                            <div className="overflow-x-auto mb-8">
                        <table className="min-w-full">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="p-3 text-left">Size</th>
                                    <th className="p-3 text-right">Boxes/Trays</th>
                                    <th className="p-3 text-right">Slices per Box/Tray</th>
                                    <th className="p-3 text-right">Total Slices</th>
                                    <th className="p-3 text-right">Low Stock Level</th>
                                    <th className="p-3 text-right">Critical Level</th>
                                    <th className="p-3 text-center">Stock Status</th>
                                    <th className="p-3 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStocks
                                    .filter(s => s.type === 'size')
                                    .map((stk) => {
                                        const sizeConfig = sizeConfigs.find(s => s.name === stk.size);
                                        const slicesPerUnit = sizeConfig?.totalSlices || 0;
                                        const totalSlices = (stk.slices || 0) * slicesPerUnit;
                                        
                                    return (
                                        <tr key={stk.id} className="border-t hover:bg-gray-50">
                                                <td className="p-3">{stk.size}</td>
                                                <td className="p-3 text-right">{stk.slices}</td>
                                                <td className="p-3 text-right">{slicesPerUnit}</td>
                                                <td className="p-3 text-right">{totalSlices}</td>
                                                <td className="p-3 text-right">{stk.minimumStock} boxes</td>
                                                <td className="p-3 text-right">{stk.criticalLevel} boxes</td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                        stk.slices <= stk.criticalLevel
                                                        ? 'bg-red-100 text-red-800'
                                                            : stk.slices <= stk.minimumStock
                                                        ? 'bg-yellow-100 text-yellow-800'
                                                        : 'bg-green-100 text-green-800'
                                                }`}>
                                                        {stk.slices <= stk.criticalLevel
                                                            ? 'Critical'
                                                            : stk.slices <= stk.minimumStock
                                                        ? 'Low Stock'
                                                        : 'In Stock'}
                                                </span>
                                            </td>
                                            <td className="p-3">
                                                <div className="flex justify-center space-x-2">
                                                    <button
                                                        onClick={() => handleAddQuantity(stk.id, stk.size)}
                                                        className="p-1 hover:bg-gray-100 rounded"
                                                        title="Add Quantity"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(stk.id, 'size')}
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
                </>
            )}

            {/* Variety Stock Table */}
            {(filterType === 'all' || filterType === 'variety') && (
                <>
                    <h3 className="text-lg font-semibold mb-2">Variety Stocks</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="p-3 text-left">Variety</th>
                                    <th className="p-3 text-right">Slices</th>
                                    <th className="p-3 text-right">Min. Slices</th>
                                    <th className="p-3 text-right">Critical Level</th>
                                    <th className="p-3 text-center">Stock Status</th>
                                    <th className="p-3 text-center">Expiry Status</th>
                                    <th className="p-3 text-left">Production Date</th>
                                    <th className="p-3 text-left">Expiry Date</th>
                                    <th className="p-3 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                        {filteredStocks
                                            .filter(s => s.type === 'variety')
                                            .map((stk) => {
                                                const expiryStatus = stk.expiryDate ? getExpiryStatus(stk.expiryDate) : { status: 'N/A', className: 'bg-gray-100 text-gray-800' };
                                    return (
                                        <tr key={stk.id} className="border-t hover:bg-gray-50">
                                                        <td className="p-3">{stk.variety}</td>
                                                        <td className="p-3 text-right">{stk.slices}</td>
                                                        <td className="p-3 text-right">{stk.minimumStock}</td>
                                                        <td className="p-3 text-right">{stk.criticalLevel}</td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs ${
                                                                stk.slices <= stk.minimumStock
                                                        ? 'bg-red-100 text-red-800'
                                                                    : stk.slices <= stk.criticalLevel
                                                        ? 'bg-yellow-100 text-yellow-800'
                                                        : 'bg-green-100 text-green-800'
                                                }`}>
                                                                {stk.slices <= stk.minimumStock
                                                        ? 'Low Stock'
                                                                    : stk.slices <= stk.criticalLevel
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
                                                        onClick={() => handleDelete(stk.id, 'variety')}
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
                        </>
                    )}
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
                                        <th className="p-3 text-left">Size</th>
                                        <th className="p-3 text-left">Variety</th>
                                        <th className="p-3 text-center">Type</th>
                                        <th className="p-3 text-right">Previous</th>
                                        <th className="p-3 text-right">Change</th>
                                        <th className="p-3 text-right">New</th>
                                        <th className="p-3 text-left">Updated By</th>
                                        <th className="p-3 text-left">Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockHistory.map((history) => (
                                        <tr key={history.id} className="border-t hover:bg-gray-50">
                                            <td className="p-3">{history.date.toLocaleDateString()}</td>
                                            <td className="p-3">{history.size}</td>
                                            <td className="p-3">{history.variety}</td>
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
                                            <td className="p-3 text-right">{history.previousSlices}</td>
                                            <td className="p-3 text-right">{history.slices}</td>
                                            <td className="p-3 text-right">{history.newSlices}</td>
                                            <td className="p-3">{history.updatedBy}</td>
                                            <td className="p-3">{history.remarks}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    );
}
