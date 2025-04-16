"use client";

import { useRouter } from "next/navigation";
import { db, storage } from "../../firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  updateDoc,
  doc,
  deleteDoc,
  query,
  orderBy,
  Timestamp,
  where,
} from "firebase/firestore";
import { PercentCircle } from "lucide-react";

// Interfaces for our data
interface Size {
  id: string;
  name: string;
  dimensions: string;
  slices: number;
  shape: string;
  price: number;
  maxVarieties: number;
  imageUrl: string;
  varieties: string[]; // Product names used as varieties
  varietySlices?: Record<string, number>; // Maps variety name to slices
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface Product {
  id: string;
  name: string;
  description: string;
  imageURL: string;
  price?: number;
  available_slices?: number;
  low_stock_threshold?: number;
  last_updated?: Date;
}

export default function PriceManagement() {
  const router = useRouter();

  // View state
  const [viewMode, setViewMode] = useState<"all" | "sizes">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productImage, setProductImage] = useState<File | null>(null);
  const [product, setProduct] = useState<{
    imageURL: string;
    name: string;
    description: string;
    price: number;
  }>({
    imageURL: "",
    name: "",
    description: "",
    price: 0,
  });
  const [editProductId, setEditProductId] = useState<string | null>(null);

  // Sizes state
  const [sizes, setSizes] = useState<Size[]>([]);
  const [isSizeModalOpen, setIsSizeModalOpen] = useState(false);
  const [sizeImage, setSizeImage] = useState<File | null>(null);
  const [size, setSize] = useState<Size>({
    id: "",
    name: "",
    dimensions: "",
    slices: 0,
    shape: "",
    price: 0,
    imageUrl: "",
    varieties: [],
    maxVarieties: 1,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  const [editSizeId, setEditSizeId] = useState<string | null>(null);
  const [selectedProductsForSize, setSelectedProductsForSize] = useState<
    Array<{ name: string; slices: number }>
  >([]);

  // Add state for product details modal
  const [isProductDetailsModalOpen, setIsProductDetailsModalOpen] =
    useState(false);
  const [selectedProductDetails, setSelectedProductDetails] =
    useState<Product | null>(null);

  useEffect(() => {
    fetchProducts();
    fetchSizes();
  }, []);

  // Fetch data functions
  const fetchProducts = async () => {
    try {
      // Fetch products from the products collection
      const querySnapshot = await getDocs(collection(db, "products"));
      const productList = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "",
        description: doc.data().description || "",
        imageURL: doc.data().imageURL || "",
        // These properties might not exist in the products collection but are kept for compatibility
        available_slices: doc.data().available_slices || 0,
        low_stock_threshold: doc.data().low_stock_threshold || 0,
        last_updated: doc.data().last_updated?.toDate() || new Date(),
      }));
      setProducts(productList);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  const fetchSizes = async () => {
    try {
      console.log("Fetching sizes from Firestore...");
      const querySnapshot = await getDocs(collection(db, "sizes"));
      console.log(`Found ${querySnapshot.docs.length} size documents`);

      // Map through each document, ensuring the ID is properly set
      const sizeList = querySnapshot.docs.map((doc) => {
        const docId = doc.id;
        console.log(`Processing document with ID: ${docId}`);

        const data = doc.data();
        console.log(`Raw data for ${docId}:`, data);

        // Create a proper Size object with an explicit ID
        const size: Size = {
          id: docId, // Use the Firestore document ID as the primary ID
          name: data.name || "",
          dimensions: data.dimensions || "",
          slices: Number(data.slices) || 0,
          shape: data.shape || "",
          price: Number(data.price) || 0,
          maxVarieties: Number(data.maxVarieties) || 1,
          imageUrl: data.imageUrl || "",
          varieties: Array.isArray(data.varieties) ? data.varieties : [],

          // Safely handle Firestore timestamps or create new ones if missing
          createdAt:
            data.createdAt instanceof Timestamp
              ? data.createdAt
              : Timestamp.now(),

          updatedAt:
            data.updatedAt instanceof Timestamp
              ? data.updatedAt
              : Timestamp.now(),
        };

        console.log(`Processed size: ${size.name} with ID: ${size.id}`);
        return size;
      });

      console.log("Fetched and processed sizes:", sizeList);

      // Update state with the processed sizes
      setSizes(sizeList);
    } catch (error) {
      console.error("Error fetching sizes:", error);
    }
  };

  // Upload image to cloudinary
  const uploadImage = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "bbnka-product-images");
    formData.append("cloud_name", "dbmofuvwn");

    try {
      const res = await fetch(
        "https://api.cloudinary.com/v1_1/dbmofuvwn/image/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await res.json();
      return data.secure_url;
    } catch (error) {
      console.error("Error uploading image: ", error);
      return null;
    }
  };

  // Product handlers
  const handleProductChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    setProduct({ ...product, [e.target.name]: e.target.value });
  };

  const handleProductImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setProductImage(e.target.files[0]);
    }
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let imageURL = product.imageURL;

      // Upload image if new one is selected
      if (productImage) {
        const uploadedImageURL = await uploadImage(productImage);
        if (uploadedImageURL) {
          imageURL = uploadedImageURL;
        } else {
          alert("Failed to upload image");
          setLoading(false);
          return;
        }
      }

      const productData = {
        ...product,
        imageURL,
        updatedAt: new Date(),
      };

      if (editProductId) {
        await updateDoc(doc(db, "products", editProductId), productData);

        // Update any sizes that use this product name in varieties
        const productSizes = sizes.filter((s) =>
          s.varieties.includes(product.name)
        );

        if (productSizes.length > 0) {
          const updatePromises = productSizes.map((size) => {
            const updatedVarieties = size.varieties.map((v) =>
              v === product.name ? productData.name : v
            );
            return updateDoc(doc(db, "sizes", size.id), {
              varieties: updatedVarieties,
              updatedAt: new Date(),
            });
          });
          await Promise.all(updatePromises);
        }

        alert("Product updated successfully!");
      } else {
        await addDoc(collection(db, "products"), {
          ...productData,
          createdAt: new Date(),
        });
        alert("Product added successfully!");
      }

      resetProductForm();
      await Promise.all([fetchProducts(), fetchSizes()]);
    } catch (error) {
      console.error("Error managing product:", error);
      alert("Operation failed. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!productId) return;

    // Find product to be deleted
    const productToDelete = products.find((p) => p.id === productId);
    if (!productToDelete) return;

    // Check if product is used in any size's varieties
    const usedInSizes = sizes.filter((s) =>
      s.varieties.includes(productToDelete.name)
    );
    if (usedInSizes.length > 0) {
      const sizeNames = usedInSizes.map((s) => s.name).join(", ");
      const confirmation = window.confirm(
        `This product is used in the following sizes: ${sizeNames}. Deleting it may affect these sizes. Do you want to continue?`
      );
      if (!confirmation) return;
    }

    if (window.confirm("Are you sure you want to delete this product?")) {
      try {
        await deleteDoc(doc(db, "products", productId));

        // Update sizes that use this product
        if (usedInSizes.length > 0) {
          const updatePromises = usedInSizes.map((size) => {
            const updatedVarieties = size.varieties.filter(
              (v) => v !== productToDelete.name
            );
            return updateDoc(doc(db, "sizes", size.id), {
              varieties: updatedVarieties,
              updatedAt: new Date(),
            });
          });
          await Promise.all(updatePromises);
        }

        alert("Product deleted successfully!");
        await Promise.all([fetchProducts(), fetchSizes()]);
      } catch (error) {
        console.error("Error deleting product:", error);
        alert("Failed to delete product. Please try again later.");
      }
    }
  };

  const resetProductForm = () => {
    setProduct({
      imageURL: "",
      name: "",
      description: "",
      price: 0,
    });
    setProductImage(null);
    setEditProductId(null);
    setIsProductModalOpen(false);
  };

  // Size handlers
  const handleSizeChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    const newValue = e.target.type === "number" ? Number(value) : value;
    setSize({ ...size, [name]: newValue });
  };

  // Handle checkboxes for selecting products as varieties
  const handleVarietySelection = (productName: string) => {
    setSelectedProductsForSize((prev) => {
      if (prev.some((item) => item.name === productName)) {
        return prev.filter((item) => item.name !== productName);
      } else {
        return [...prev, { name: productName, slices: 1 }];
      }
    });
  };

  const handleSizeImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSizeImage(e.target.files[0]);
    }
  };

  // Modify the part of handleSizeSubmit that deals with new varieties
  const handleSizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let imageUrl = size.imageUrl;

      // Upload image if new one is selected
      if (sizeImage) {
        const uploadedImageURL = await uploadImage(sizeImage);
        if (uploadedImageURL) {
          imageUrl = uploadedImageURL;
        }
      }

      // Get all unique varieties from the form
      const uniqueVarieties = Array.from(
        new Set(
          selectedProductsForSize
            .map((item) => item.name.trim())
            .filter((name) => name !== "")
        )
      );

      if (editSizeId) {
        console.log("Updating existing size with ID:", editSizeId);
        // Update existing record
        const sizeRef = doc(db, "sizes", editSizeId);
        await updateDoc(sizeRef, {
          name: size.name,
          dimensions: size.dimensions,
          slices: Number(size.slices) || 0,
          shape: size.shape,
          price: Number(size.price) || 0,
          maxVarieties: Number(size.maxVarieties) || 1,
          imageUrl,
          varieties: uniqueVarieties,
          updatedAt: new Date(),
        });
        alert("Size updated successfully!");
      } else {
        console.log("Creating new size");
        // Create new record - don't include id property when creating a new record
        const newSizeData = {
          name: size.name,
          dimensions: size.dimensions,
          slices: Number(size.slices) || 0,
          shape: size.shape,
          price: Number(size.price) || 0,
          maxVarieties: Number(size.maxVarieties) || 1,
          imageUrl,
          varieties: uniqueVarieties,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const docRef = await addDoc(collection(db, "sizes"), newSizeData);

        // Get the document ID
        const newSizeId = docRef.id;
        console.log("Created new size with ID:", newSizeId);

        // Update the document with its ID
        await updateDoc(doc(db, "sizes", newSizeId), { id: newSizeId });

        alert("Size added successfully!");
      }

      resetSizeForm();
      // Make sure to await the fetchSizes call
      await fetchSizes();
    } catch (error) {
      console.error("Error managing size:", error);
      alert("Operation failed. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSize = async (sizeId: string) => {
    // Additional validation to ensure sizeId is a valid string
    if (!sizeId || typeof sizeId !== "string" || sizeId.trim() === "") {
      console.error("No valid size ID provided for deletion:", sizeId);
      alert("Error: Cannot delete size because the ID is missing or invalid.");
      return;
    }

    console.log(`Attempting to delete size with ID: "${sizeId}"`);

    // Find the size in our state to confirm it exists
    const sizeToDelete = sizes.find((s) => s.id === sizeId);
    if (!sizeToDelete) {
      console.error(`Size with ID ${sizeId} not found in local state`);
      alert(
        "Error: Size not found in the current list. Please refresh the page and try again."
      );
      return;
    }

    if (
      window.confirm(
        `Are you sure you want to delete the size "${sizeToDelete.name}"?`
      )
    ) {
      try {
        setLoading(true);

        // Delete the size from Firestore
        const sizeRef = doc(db, "sizes", sizeId);
        console.log("Deleting from Firestore with ref:", sizeRef);
        await deleteDoc(sizeRef);

        console.log("Size deleted successfully");
        alert("Size deleted successfully!");

        // Refresh the sizes list
        await fetchSizes();
      } catch (error) {
        console.error("Error deleting size:", error);
        alert("Failed to delete size. Please try again later.");
      } finally {
        setLoading(false);
      }
    }
  };

  const resetSizeForm = () => {
    setSize({
      id: "",
      name: "",
      dimensions: "",
      slices: 0,
      shape: "",
      price: 0,
      imageUrl: "",
      varieties: [],
      maxVarieties: 1,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    setSizeImage(null);
    setEditSizeId(null);
    setSelectedProductsForSize([]);
    setIsSizeModalOpen(false);
  };

  // Filter data based on search term
  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // First validate sizes have IDs before filtering by search term
  const validSizes = sizes.filter((size) => {
    if (!size.id || typeof size.id !== "string" || size.id.trim() === "") {
      console.warn("Found invalid size without proper ID:", size);
      return false;
    }
    return true;
  });

  const filteredSizes = validSizes.filter(
    (s) =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.dimensions.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.varieties.some((v) =>
        v.toLowerCase().includes(searchTerm.toLowerCase())
      )
  );

  // Log filtered sizes to verify IDs
  console.log(
    "Filtered sizes with IDs:",
    filteredSizes.map((s) => ({ id: s.id, name: s.name }))
  );

  // Function to view product details
  const viewProductDetails = (productName: string) => {
    const product = products.find((p) => p.name === productName);
    if (product) {
      setSelectedProductDetails(product);
      setIsProductDetailsModalOpen(true);
    }
  };

  return (
    <ProtectedRoute>
      <div className="flex h-screen overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-gray-100">
          <div className="p-6">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">
              Price Management
            </h1>

            {/* Search and Controls */}
            <div className="bg-white p-4 rounded-lg shadow-md mb-6 flex flex-wrap gap-4 items-center">
              <div className="relative w-full max-w-sm min-w-[200px]">
                <input
                  className="w-full pr-11 h-10 pl-3 py-2 bg-transparent placeholder:text-slate-400 text-slate-700 text-sm border border-slate-200 rounded transition duration-300 ease focus:outline-none focus:border-slate-400 hover:border-slate-400 shadow-sm focus:shadow-md"
                  placeholder="Search products or sizes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="absolute h-8 w-8 right-1 top-1 my-auto px-2 flex items-center rounded">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    stroke="currentColor"
                    className="w-5 h-5 text-slate-600"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                    />
                  </svg>
                </div>
              </div>

              <div className="ml-auto flex space-x-3">
                <button
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await fetchSizes();
                      await fetchProducts();
                      alert("Data refreshed successfully!");
                    } catch (error) {
                      console.error("Error refreshing data:", error);
                      alert("Failed to refresh data. Please try again.");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  disabled={loading}
                >
                  {loading ? "Refreshing..." : "Refresh Data"}
                </button>
                <button
                  onClick={() => router.push("/inventory/products")}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Manage Products
                </button>
                <button
                  onClick={() => {
                    resetSizeForm();
                    setIsSizeModalOpen(true);
                  }}
                  className="px-4 py-2 bg-bg-light-brown text-white rounded hover:bg-opacity-90"
                  disabled={loading}
                >
                  + Add Size
                </button>
              </div>
            </div>

            {/* Sizes Table */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b">
                      <th className="p-4 bg-gray-50">Image</th>
                      <th className="p-4 bg-gray-50">Name</th>
                      <th className="p-4 bg-gray-50">Dimensions</th>
                      <th className="p-4 bg-gray-50">Slices</th>
                      <th className="p-4 bg-gray-50">Shape</th>
                      <th className="p-4 bg-gray-50">Max Selections</th>
                      <th className="p-4 bg-gray-50">Varieties</th>
                      <th className="p-4 bg-gray-50">Price</th>
                      <th className="p-4 bg-gray-50">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSizes.length > 0 ? (
                      // Only map over sizes that have a valid ID
                      filteredSizes
                        .filter((size) => {
                          if (!size.id) {
                            console.warn("Found a size without ID:", size);
                            return false;
                          }
                          return true;
                        })
                        .map((size) => (
                          <tr
                            key={size.id}
                            className="border-b hover:bg-gray-50"
                          >
                            <td className="p-4">
                              {size.imageUrl && (
                                <img
                                  src={size.imageUrl}
                                  alt={size.name}
                                  className="w-16 h-16 object-cover rounded"
                                />
                              )}
                            </td>
                            <td className="p-4">{size.name}</td>
                            <td className="p-4">{size.dimensions}</td>
                            <td className="p-4">{size.slices}</td>
                            <td className="p-4">{size.shape}</td>
                            <td className="p-4">{size.maxVarieties}</td>
                            <td className="p-4">
                              <div className="flex flex-wrap gap-1">
                                {size.varieties.map((varietyName) => {
                                  // Find matching product for this variety name
                                  const matchingProduct = products.find(
                                    (p) => p.name === varietyName
                                  );

                                  return (
                                    <div
                                      key={varietyName}
                                      className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs flex items-center gap-1 cursor-pointer hover:bg-green-200"
                                      onClick={() => viewProductDetails(varietyName)}
                                    >
                                      {matchingProduct?.imageURL && (
                                        <img
                                          src={matchingProduct.imageURL}
                                          alt={varietyName}
                                          className="w-4 h-4 rounded-full object-cover"
                                        />
                                      )}
                                      <span>{varietyName}</span>
                                    </div>
                                  );
                                })}
                                {size.varieties.length === 0 && (
                                  <span className="text-gray-400">None</span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">₱{size.price.toFixed(2)}</td>
                            <td className="p-4">
                              <button
                                onClick={() => {
                                  setEditSizeId(size.id);
                                  setSize(size);

                                  // Set the selected products for the size
                                  // Make sure we're using the correct property name from products collection
                                  const selectedVarieties = size.varieties.map(
                                    (varietyName: string) => {
                                      return {
                                        name: varietyName,
                                        slices: 1, // Default to 1 slice per variety
                                      };
                                    }
                                  );

                                  setSelectedProductsForSize(selectedVarieties);
                                  setIsSizeModalOpen(true);
                                }}
                                className="text-blue-600 hover:text-blue-800 mr-4"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  const sizeId = size.id;
                                  console.log(
                                    "Delete button clicked for size:",
                                    size
                                  );
                                  console.log(
                                    "Size ID:",
                                    sizeId,
                                    "Type:",
                                    typeof sizeId
                                  );

                                  // Check if size ID exists and is a non-empty string
                                  if (
                                    sizeId &&
                                    typeof sizeId === "string" &&
                                    sizeId.trim() !== ""
                                  ) {
                                    // Directly pass the string ID to the delete function
                                    handleDeleteSize(sizeId);
                                  } else {
                                    console.error(
                                      "Size ID is missing or invalid:",
                                      sizeId
                                    );
                                    alert(
                                      "Error: Cannot delete size because the ID is missing or invalid."
                                    );
                                  }
                                }}
                                className="text-red-600 hover:text-red-800"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                    ) : (
                      <tr>
                        <td colSpan={9} className="p-4 text-center">
                          No sizes found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Size Modal */}
      {isSizeModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editSizeId ? "Edit Size" : "Add Size"}
            </h3>
            <form onSubmit={handleSizeSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={size.name}
                    onChange={handleSizeChange}
                    className="mt-1 block w-full rounded border-gray-300 shadow-sm px-3 py-2 border"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Price (₱)
                  </label>
                  <input
                    type="number"
                    name="price"
                    value={size.price}
                    onChange={handleSizeChange}
                    className="mt-1 block w-full rounded border-gray-300 shadow-sm px-3 py-2 border"
                    required
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Dimensions
                  </label>
                  <input
                    type="text"
                    name="dimensions"
                    value={size.dimensions}
                    onChange={handleSizeChange}
                    className="mt-1 block w-full rounded border-gray-300 shadow-sm px-3 py-2 border"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Shape
                  </label>
                  <select
                    name="shape"
                    value={size.shape}
                    onChange={handleSizeChange}
                    className="mt-1 block w-full rounded border-gray-300 shadow-sm px-3 py-2 border"
                    required
                  >
                    <option value="">Select shape</option>
                    <option value="Round">Round</option>
                    <option value="Rectangle">Rectangle</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Max Customer Selections
                  </label>
                  <input
                    type="number"
                    name="maxVarieties"
                    value={size.maxVarieties}
                    onChange={handleSizeChange}
                    className="mt-1 block w-full rounded border-gray-300 shadow-sm px-3 py-2 border"
                    required
                    min="1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Maximum number of varieties a customer can select
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Slices
                  </label>
                  <input
                    type="number"
                    name="slices"
                    value={size.slices}
                    onChange={handleSizeChange}
                    className="mt-1 block w-full rounded border-gray-300 shadow-sm px-3 py-2 border"
                    required
                    min="0"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Size Image
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleSizeImageChange}
                  className="mt-1 block w-full rounded border-gray-300 shadow-sm px-3 py-2 border"
                />
                {size.imageUrl && (
                  <div className="mt-2">
                    <img
                      src={size.imageUrl}
                      alt="Size preview"
                      className="w-20 h-20 object-cover rounded"
                    />
                  </div>
                )}
              </div>
              <div>
                <div className="border border-gray-300 rounded-md p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Product Varieties Selection
                  </label>

                  {/* Display selected products */}
                  <div className="space-y-3 mb-4">
                    {selectedProductsForSize.length > 0 ? (
                      selectedProductsForSize.map((item, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => {
                              const updatedVarieties = [
                                ...selectedProductsForSize,
                              ];
                              updatedVarieties[index] = {
                                ...item,
                                name: e.target.value,
                              };
                              setSelectedProductsForSize(updatedVarieties);
                            }}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="Product name"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const updatedVarieties =
                                selectedProductsForSize.filter(
                                  (_, i) => i !== index
                                );
                              setSelectedProductsForSize(updatedVarieties);
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              className="w-5 h-5"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">
                        No varieties added. Select from available products below
                        or add custom varieties.
                      </p>
                    )}
                  </div>

                  {/* Available products from products collection */}
                  <div className="mt-4 border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      Available Products
                    </h4>
                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                      {products.length > 0 ? (
                        products.map((product) => (
                          <div
                            key={product.id}
                            className={`p-2 border rounded-md cursor-pointer flex items-center gap-2 ${
                              selectedProductsForSize.some(
                                (item) => item.name === product.name
                              )
                                ? "bg-green-50 border-green-200"
                                : "hover:bg-gray-50"
                            }`}
                            onClick={() => {
                              // Toggle selection
                              if (
                                selectedProductsForSize.some(
                                  (item) => item.name === product.name
                                )
                              ) {
                                setSelectedProductsForSize((prev) =>
                                  prev.filter(
                                    (item) => item.name !== product.name
                                  )
                                );
                              } else {
                                setSelectedProductsForSize((prev) => [
                                  ...prev,
                                  { name: product.name, slices: 1 },
                                ]);
                              }
                            }}
                          >
                            {product.imageURL && (
                              <img
                                src={product.imageURL}
                                alt={product.name}
                                className="w-8 h-8 object-cover rounded"
                              />
                            )}
                            <span className="text-sm truncate">
                              {product.name}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-gray-500 col-span-2">
                          No products available. Add products in the Products
                          page.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Button to add custom variety */}
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedProductsForSize([
                          ...selectedProductsForSize,
                          { name: "", slices: 1 },
                        ])
                      }
                      className="w-full py-2 px-3 border border-dashed border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 flex items-center justify-center"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        className="w-4 h-4 mr-1"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                      Add Custom Variety
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setIsSizeModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-bg-light-brown text-white rounded hover:bg-opacity-90"
                  disabled={loading}
                >
                  {loading ? "Processing..." : editSizeId ? "Update" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Details Modal */}
      {isProductDetailsModalOpen && selectedProductDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold">Product Details</h3>
              <button
                onClick={() => setIsProductDetailsModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {selectedProductDetails.imageURL && (
                <div className="flex justify-center">
                  <img
                    src={selectedProductDetails.imageURL}
                    alt={selectedProductDetails.name}
                    className="w-40 h-40 object-cover rounded-lg"
                  />
                </div>
              )}

              <div>
                <h4 className="text-lg font-semibold">
                  {selectedProductDetails.name}
                </h4>
                <p className="text-gray-600 mt-1">
                  {selectedProductDetails.description}
                </p>
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={() =>
                    router.push(
                      `/inventory/products?edit=${selectedProductDetails.id}`
                    )
                  }
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Edit in Products Page
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
}
