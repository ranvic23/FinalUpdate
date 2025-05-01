import { db } from "../firebase-config";
import { doc, getDoc, setDoc } from "firebase/firestore";

const modulePermissions = {
    inventory: {
        name: 'Inventory Management',
        permissions: [
            { id: 'view_inventory', name: 'View Inventory' },
            { id: 'manage_stock', name: 'Manage Stock' },
            { id: 'add_stock', name: 'Add New Stock' },
            { id: 'edit_stock', name: 'Edit Stock' },
            { id: 'delete_stock', name: 'Delete Stock' }
        ]
    },
    orders: {
        name: 'Order Management',
        permissions: [
            { id: 'view_orders', name: 'View Orders' },
            { id: 'process_orders', name: 'Process Orders' },
            { id: 'cancel_orders', name: 'Cancel Orders' }
        ]
    },
    reports: {
        name: 'Reports',
        permissions: [
            { id: 'view_reports', name: 'View Reports' },
            { id: 'export_reports', name: 'Export Reports' }
        ]
    },
    users: {
        name: 'User Management',
        permissions: [
            { id: 'view_users', name: 'View Users' },
            { id: 'manage_users', name: 'Manage Users' }
        ]
    }
};

export async function setupSpecificAdmin(uid: string) {
    try {
        // Get all permissions
        const allPermissions = Object.values(modulePermissions)
            .flatMap(module => module.permissions)
            .map(p => p.id);

        // Get existing user data
        const userDoc = await getDoc(doc(db, "users", uid));
        const existingData = userDoc.exists() ? userDoc.data() : {};

        // Prepare admin data
        const adminData = {
            ...existingData,
            role: "admin",
            status: "active",
            permissions: allPermissions,
            emailVerified: true,
            updatedAt: new Date()
        };

        // Update user document
        await setDoc(doc(db, "users", uid), adminData, { merge: true });
        console.log("Admin user updated successfully");
        return true;
    } catch (error) {
        console.error("Error setting up admin user:", error);
        return false;
    }
}

// Execute the function
setupSpecificAdmin("lgn9GWr1kIdq5Ai7wFGaSKXPHCf1")
    .then(success => console.log("Admin setup completed:", success))
    .catch(error => console.error("Error:", error)); 