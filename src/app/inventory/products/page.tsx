"use client"; // Required for using hooks

import { db } from "../../firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, updateDoc, query, where, Query, DocumentData } from "firebase/firestore";

export default function Inventory() {
    const [image, setImage] = useState<File | null>(null);
    const [isOpen, setIsOpen] = useState(false); // state for modal visibility
    const [editProduct, setEditProduct] = useState<string | null>(null); // state for editing product
    const [showPendingOnly, setShowPendingOnly] = useState(false);

    // state for product details (array - displaying products)
    const [products, setProducts] = useState<Array<{
        id: string,
        imageURL: string,
        name: string,
        price: string,
        stock: string,
        unit: string,
        description: string,
        status: 'pending' | 'approved' | 'rejected',
        createdAt: Date,
        updatedAt: Date,
    }>>([]);

    // state for product details (single - adding products)
    const [product, setProduct] = useState({
        imageURL: "",
        name: "",
        description: "",
        status: "pending" as 'pending' | 'approved' | 'rejected',
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setProduct({ ...product, [e.target.name]: e.target.value });
    };

    //handle image file selection
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setImage(e.target.files[0]);
        }
    };

    // function to upload image to cloudinary
    const uploadImage = async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", "bbnka-product-images"); // asset folder name
        formData.append("cloud_name", "dbmofuvwn"); // Cloudinary cloud name

        try {
            const res = await fetch("https://api.cloudinary.com/v1_1/dbmofuvwn/image/upload", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            return data.secure_url; // get the uploaded image URL
        } catch (error) {
            console.error("Error uploading image: ", error);
            return null;
        }
    };

    useEffect(() => {
        fetchProducts();
    }, [showPendingOnly]);

    // fetch products from firestore
    const fetchProducts = async () => {
        try {
            const productsCollection = collection(db, "products");
            
            // If showing pending only, add the status filter
            const productsQuery: Query<DocumentData> = showPendingOnly
                ? query(productsCollection, where("status", "==", "pending"))
                : query(productsCollection);

            const querySnapshot = await getDocs(productsQuery);
            const productList = querySnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    imageURL: data.imageURL || "",
                    name: data.name || "",
                    price: data.price || "",
                    stock: data.stock || "",
                    unit: data.unit || "",
                    description: data.description || "",
                    status: data.status || "pending",
                    createdAt: data.createdAt?.toDate() || new Date(),
                    updatedAt: data.updatedAt?.toDate() || new Date(),
                };
            });
    
            console.log("Fetched products:", productList);
            setProducts(productList);
        } catch (error) {
            console.error("Error fetching products:", error);
            alert("Failed to load products");
        }
    };

    // function to handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        console.log("Submitting form...");

        try {
            let imageURL = "";

            // upload image to cloudinary
            if (image) {
                const uploadedImageURL = await uploadImage(image);
                if (!uploadedImageURL) {
                    alert("Failed to upload image");
                    return;
                }
                imageURL = uploadedImageURL;
            }

            // save product details in firestore with pending status
            await addDoc(collection(db, "products"), {
                imageURL,
                name: product.name,
                description: product.description,
                status: "pending",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            alert("Product added successfully and is pending approval!");

            // clear form state
            setProducts([]);
            setImage(null); 

            // Fetch products again to update UI
            fetchProducts();
        } catch (error) {
            console.error("Error adding product: ", error);
            alert("Failed to add product. Please try again later.");
        }
    };
    
    const handleEdit = async (productID: string) => {
        if (!productID) return;

        try {
            await updateDoc(doc(db, "products", productID), {
                imageURL: product.imageURL,
                name: product.name,
                description: product.description,
                updatedAt: new Date(),
            });

            alert("Product updated successfully!");

            // Reset form and close modal
            setProducts([]);
            setImage(null);
    
            // Refresh products
            fetchProducts();
        } catch (error) {
            console.error("Error updating product:", error);
            alert("Failed to update product.");
        }
    };
    
    const handleApproval = async (productId: string, newStatus: 'approved' | 'rejected') => {
        try {
            await updateDoc(doc(db, "products", productId), {
                status: newStatus,
                updatedAt: new Date(),
            });

            alert(`Product ${newStatus} successfully!`);
            fetchProducts();
        } catch (error) {
            console.error("Error updating product status:", error);
            alert("Failed to update product status.");
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved':
                return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Approved</span>;
            case 'rejected':
                return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Rejected</span>;
            default:
                return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
        }
    };

    return (
        <ProtectedRoute requiredPermissions={["manage_stock"]}>
            <div className="flex flex-col justify-center items-center h-screen bg-gray-100">
                <h1 className="text-3xl font-bold text-gray-800 mb-4">
                    Product Management
                </h1>

                <div className="w-full flex flex-col p-4">
                    <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-4">
                            <div className="relative w-full max-w-sm min-w-[200px]">
                                <input
                                    className="bg-white w-full pr-11 h-10 pl-3 py-2 bg-transparent placeholder:text-slate-400 text-slate-700 text-sm border border-slate-200 rounded transition duration-300 ease focus:outline-none focus:border-slate-400 hover:border-slate-400 shadow-sm focus:shadow-md"
                                    placeholder="Search for products..."
                                />

                                {/* search button */}
                                <button
                                    className="absolute h-8 w-8 right-1 top-1 my-auto px-2 flex items-center bg-white rounded "
                                    type="button"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-8 h-8 text-slate-600">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                    </svg>
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="showPending"
                                    checked={showPendingOnly}
                                    onChange={(e) => setShowPendingOnly(e.target.checked)}
                                    className="h-4 w-4"
                                />
                                <label htmlFor="showPending" className="text-sm text-gray-600">
                                    Show Pending Only
                                </label>
                            </div>
                        </div>

                        {/* Button to open modal */}
                        <button
                            onClick={() => {
                                setEditProduct(null);
                                setProduct({
                                    imageURL: "",
                                    name: "",
                                    description: "",
                                    status: "pending",
                                });
                                setIsOpen(true);
                            }}
                            className="px-6 py-3 rounded text-center text-sm font-semibold text-white bg-bg-light-brown shadow-md shadow-slate-900/10 transition-all hover:shadow-lg hover:shadow-slate-900/20 active:opacity-[0.85] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none">+ Add Product
                        </button>
                    </div>
                </div>

                <div className="relative flex flex-col w-full h-full overflow-scroll text-gray-700 bg-white shadow-md rounded-lg bg-clip-border mx-4">
                    <table className="w-full text-left table-auto min-w-max">
                        <thead>
                            <tr>
                                <th className="p-4 border-b border-slate-300 bg-slate-50">
                                    <p className="block text-sm font-normal leading-none text-slate-500">Image</p>
                                </th>
                                <th className="p-4 border-b border-slate-300 bg-slate-50">
                                    <p className="block text-sm font-normal leading-none text-slate-500">Name</p>
                                </th>
                                <th className="p-4 border-b border-slate-300 bg-slate-50">
                                    <p className="block text-sm font-normal leading-none text-slate-500">Description</p>
                                </th>
                                <th className="p-4 border-b border-slate-300 bg-slate-50">
                                    <p className="block text-sm font-normal leading-none text-slate-500">Status</p>
                                </th>
                                <th className="p-4 border-b border-slate-300 bg-slate-50">
                                    <p className="block text-sm font-normal leading-none text-slate-500">Actions</p>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.length > 0 ? (
                                products.map((product) => (
                                    <tr key={product.id} className="hover:bg-slate-50 border-b border-slate-200">
                                        <td className="p-4 py-5">
                                            <img src={product.imageURL} alt={product.name} className="w-16 h-16 object-cover rounded" />
                                        </td>
                                        <td className="p-4 py-5 text-sm text-slate-800">{product.name}</td>
                                        <td className="p-4 py-5 text-sm text-slate-800 break-words whitespace-pre-wrap max-w-xs">{product.description}</td>
                                        <td className="p-4 py-5">
                                            {getStatusBadge(product.status)}
                                        </td>
                                        <td className="p-4 py-5">
                                            <div className="flex items-center gap-2">
                                                {product.status === 'pending' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleApproval(product.id, 'approved')}
                                                            className="text-green-600 hover:text-green-800"
                                                            title="Approve"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                                        </button>
                                                        <button
                                                            onClick={() => handleApproval(product.id, 'rejected')}
                                                            className="text-red-600 hover:text-red-800"
                                                            title="Reject"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    className="text-slate-600 hover:text-slate-800"
                                                    onClick={() => {
                                                        setIsOpen(true);
                                                        setEditProduct(product.id);
                                                        setProduct({
                                                            imageURL: product.imageURL,
                                                            name: product.name,
                                                            description: product.description,
                                                            status: product.status,
                                                        });
                                                    }}
                                                    title="Edit"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" strokeWidth={0} strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className="text-center p-4">No products available.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Add/Edit Product Modal */}
                {isOpen && (
                    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
                        <div className="bg-white rounded-lg shadow-lg p-6 w-96">
                            <form onSubmit={(e) => {
                                e.preventDefault();
                                if (editProduct) {
                                    handleEdit(editProduct);
                                } else {
                                    handleSubmit(e);
                                }
                            }} className="flex flex-col gap-4">
                                <div className="w-full max-w-sm min-w-[200px]">
                                    <input
                                        className="w-full bg-transparent placeholder:text-slate-400 text-slate-700 text-sm border border-slate-200 rounded-md px-3 py-2 transition duration-300 ease focus:outline-none focus:border-blue-500 hover:border-blue-300 shadow-sm focus:shadow"
                                        type="file"
                                        accept="image/*"
                                        onChange={handleImageChange}
                                    />
                                </div>
                                <div className="w-full max-w-sm min-w-[200px]">
                                    <input
                                        className="w-full bg-transparent placeholder:text-slate-400 text-slate-700 text-sm border border-slate-200 rounded-md px-3 py-2 transition duration-300 ease focus:outline-none focus:border-blue-500 hover:border-blue-300 shadow-sm focus:shadow"
                                        type="text"
                                        name="name"
                                        value={product.name}
                                        onChange={handleChange}
                                        placeholder="Product Name"
                                        required
                                    />
                                </div>
                                <div className="w-full max-w-sm min-w-[200px]">
                                    <textarea
                                        className="w-full h-40 bg-transparent placeholder:text-slate-400 text-slate-700 text-sm border border-slate-200 rounded-md px-3 py-2 transition duration-300 ease focus:outline-none focus:border-blue-500 hover:border-blue-300 shadow-sm focus:shadow"
                                        name="description"
                                        value={product.description}
                                        onChange={handleChange}
                                        placeholder="Description"
                                        required
                                    />
                                </div>
                                <div className="flex space-x-2">
                                    <button
                                        className="w-full mx-auto select-none rounded border border-red-600 py-2 px-4 text-center text-sm font-semibold text-red-600 transition-all hover:bg-red-600 hover:text-white hover:shadow-md hover:shadow-red-600/20 active:bg-red-700 active:text-white active:opacity-[0.85] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none"
                                        type="button"
                                        onClick={() => setIsOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="w-full mx-auto select-none rounded bg-bg-light-brown py-2 px-4 text-center text-sm font-semibold text-white shadow-md shadow-slate-900/10 transition-all hover:shadow-lg hover:shadow-slate-900/20 active:opacity-[0.85] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none"
                                        type="submit"
                                    >
                                        {editProduct ? "Update" : "Add"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}