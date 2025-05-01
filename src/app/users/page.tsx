"use client"; // Required for using hooks

import { db } from "../firebase-config";
import ProtectedRoute from "@/app/components/protectedroute";
import { useEffect, useState } from "react";
import { collection, doc, getDocs, updateDoc, query, where, orderBy, setDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { auth } from "../firebase-config";
import { 
    UserPlus,
    Search,
    Edit,
} from 'lucide-react';

interface User {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'staff';
    status: 'active' | 'inactive';
    permissions: string[];
    lastLogin?: Date;
    createdAt: Date;
    emailVerified: boolean;
}

interface UserData {
    name: string;
    email: string;
    role: 'admin' | 'staff';
    status: 'active' | 'inactive';
    permissions: string[];
    permissionDescriptions: { [key: string]: string } | null;
    updatedAt: Date;
    createdAt?: Date;
    uid?: string;
    emailVerified: boolean;
    [key: string]: string | Date | string[] | { [key: string]: string } | null | boolean | undefined;
}

export default function Users() {
    const [users, setUsers] = useState<User[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalType, setModalType] = useState<'add' | 'edit'>('add');

    const [userForm, setUserForm] = useState({
        name: "",
        email: "",
        role: "staff",
        status: "active",
        password: "",
        phoneNumber: "",
        address: "",
        permissions: [] as string[],
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const userQuery = query(
                collection(db, "users"),
                where("role", "==", "staff"),
                orderBy("createdAt", "desc")
            );

            const querySnapshot = await getDocs(userQuery);
            const userList = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate(),
                lastLogin: doc.data().lastLogin?.toDate(),
                emailVerified: doc.data().emailVerified,
            })) as User[];

            setUsers(userList);
        } catch (error) {
            console.error("Error fetching users:", error);
            alert("Failed to load users");
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                throw new Error('You must be logged in to perform this action');
            }

            // Check if current user is admin
            const currentUserDoc = await getDocs(query(
                collection(db, "users"),
                where("email", "==", currentUser.email)
            ));
            
            const currentUserData = currentUserDoc.docs[0]?.data();
            if (currentUserData?.role !== 'admin') {
                throw new Error('Only administrators can manage users');
            }

            // Define default staff permissions
            const defaultStaffPermissions = [
                // Inventory permissions - restricted to viewing and basic management
                'view_inventory',
                'manage_stock',
                // Orders permissions - restricted to viewing and processing
                'view_orders',
                'process_orders'
            ];

            // Define permission descriptions for staff restrictions
            const staffPermissionDescriptions = {
                'view_inventory': 'Can view inventory items and stock levels',
                'manage_stock': 'Can update existing stock quantities',
                'view_orders': 'Can view incoming orders',
                'process_orders': 'Can process and update order status'
            };

            const userData: UserData = {
                name: userForm.name,
                email: userForm.email,
                role: 'staff',
                status: userForm.status as 'active' | 'inactive',
                permissions: defaultStaffPermissions,
                permissionDescriptions: staffPermissionDescriptions,
                updatedAt: new Date(),
                createdAt: modalType === 'add' ? new Date() : undefined,
                uid: undefined,
                emailVerified: false
            };

            if (modalType === 'edit') {
                await updateDoc(doc(db, "users", selectedUser!.id), userData);
            } else {
                // Create new user with Firebase Auth
                const userCredential = await createUserWithEmailAndPassword(
                    auth,
                    userForm.email,
                    userForm.password
                );

                // Update the userData with the new user's UID
                userData.uid = userCredential.user.uid;

                // Create user document in Firestore
                await setDoc(doc(db, "users", userCredential.user.uid), userData);

                // Send verification email
                await sendEmailVerification(userCredential.user, {
                    url: window.location.origin + "/verify-email",
                    handleCodeInApp: true
                });

                // Sign out the newly created user
                await auth.signOut();

                // Show success message
                alert("User account created successfully. A verification email has been sent to " + userForm.email);
                
                // Redirect to login page
                window.location.href = "/";
            }

            setIsModalOpen(false);
            resetForm();
            fetchUsers();
        } catch (error) {
            console.error("Error handling user:", error);
            alert(error instanceof Error ? error.message : "Failed to process user");
        }
    };

    const resetForm = () => {
        setUserForm({
            name: "",
            email: "",
            role: "staff",
            status: "active",
            password: "",
            phoneNumber: "",
            address: "",
            permissions: [],
        });
        setSelectedUser(null);
    };

    const filteredUsers = users.filter(user => {
        const matchesSearch = 
            user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    return (
        <ProtectedRoute requiredPermissions={["manage_users"]}>
            <div className="min-h-screen bg-gray-100 p-6">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-800">Staff Management</h1>
                </div>

                {/* Filters and Controls */}
                <div className="bg-white p-4 rounded-lg shadow-md mb-6">
                    <div className="flex flex-wrap gap-4 items-center">
                        <div className="flex-1 relative">
                            <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search staff..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 p-2 border rounded w-full"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="p-2 border rounded"
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>
                        <button
                            onClick={() => {
                                setModalType('add');
                                setIsModalOpen(true);
                            }}
                            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 flex items-center gap-2"
                        >
                            <UserPlus className="w-5 h-5" />
                            Add New Staff
                        </button>
                    </div>
                </div>

                {/* Users Table */}
                <div className="bg-white rounded-lg shadow-md overflow-hidden mb-6">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Staff Info
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Email Verification
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Last Activity
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredUsers.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center">
                                            <div>
                                                <div className="font-medium text-gray-900">{user.name}</div>
                                                <div className="text-sm text-gray-500">{user.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded-full text-xs inline-flex items-center w-fit ${
                                            user.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                            {user.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded-full text-xs ${
                                            user.emailVerified
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-yellow-100 text-yellow-800'
                                        }`}>
                                            {user.emailVerified ? 'Verified' : 'Pending'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm text-gray-500">
                                            {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => {
                                                setSelectedUser(user);
                                                setModalType('edit');
                                                setIsModalOpen(true);
                                            }}
                                            className="text-blue-600 hover:text-blue-900"
                                            title="Edit Staff"
                                        >
                                            <Edit className="w-5 h-5 inline-block" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Add/Edit User Modal */}
                {isModalOpen && (modalType === 'add' || modalType === 'edit') && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                        <div className="bg-white p-6 rounded-lg w-full max-w-md">
                            <h2 className="text-xl font-semibold mb-4">
                                {modalType === 'add' ? 'Add New Staff' : 'Edit Staff'}
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <input
                                    type="text"
                                    placeholder="Name"
                                    value={userForm.name}
                                    onChange={(e) => setUserForm({...userForm, name: e.target.value})}
                                    className="w-full p-2 border rounded"
                                    required
                                />
                                <input
                                    type="email"
                                    placeholder="Email"
                                    value={userForm.email}
                                    onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                                    className="w-full p-2 border rounded"
                                    required
                                />
                                {modalType === 'add' && (
                                    <input
                                        type="password"
                                        placeholder="Password"
                                        value={userForm.password}
                                        onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                                        className="w-full p-2 border rounded"
                                        required
                                    />
                                )}
                                <select
                                    value={userForm.status}
                                    onChange={(e) => setUserForm({...userForm, status: e.target.value as 'active' | 'inactive'})}
                                    className="w-full p-2 border rounded"
                                    required
                                >
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                                <div className="flex justify-end gap-4">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsModalOpen(false);
                                            resetForm();
                                        }}
                                        className="px-4 py-2 text-gray-600 hover:text-gray-800"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                    >
                                        {modalType === 'add' ? 'Create Staff' : 'Save Changes'}
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
