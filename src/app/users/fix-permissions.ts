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

export async function fixAdminPermissions(uid: string) {
    try {
        // Get all permissions
        const allPermissions = Object.values(modulePermissions)
            .flatMap(module => module.permissions)
            .map(p => p.id);

        // Get existing user data
        const userDoc = await getDoc(doc(db, "users", uid));
        
        if (!userDoc.exists()) {
            // Create new admin document if it doesn't exist
            const adminData = {
                name: "Administrator",
                role: "admin",
                status: "active",
                permissions: allPermissions,
                emailVerified: true,
                createdAt: new Date(),
                lastLogin: new Date(),
                updatedAt: new Date()
            };
            await setDoc(doc(db, "users", uid), adminData);
            console.log("Created new admin user document");
            return true;
        }

        const existingData = userDoc.data();
        
        // Update admin data
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
        console.log("Updated admin permissions successfully");
        return true;
    } catch (error) {
        console.error("Error fixing admin permissions:", error);
        return false;
    }
}

// Execute the function
fixAdminPermissions("lgn9GWr1kIdq5Ai7wFGaSKXPHCf1")
    .then(success => {
        console.log("Admin permissions fix completed:", success);
        if (success) {
            console.log("Your account should now have full admin access");
            console.log("Please try accessing the Users module again");
        }
    })
    .catch(error => console.error("Error:", error)); 