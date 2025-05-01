import { auth, db } from "../firebase-config";
import { collection, doc, setDoc, getDocs, query, where } from "firebase/firestore";

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

export async function setupAdminUser(adminEmail: string) {
    try {
        // Check if admin user already exists
        const userQuery = query(
            collection(db, "users"),
            where("email", "==", adminEmail)
        );
        const userSnapshot = await getDocs(userQuery);

        if (userSnapshot.empty) {
            // Get all permissions
            const allPermissions = Object.values(modulePermissions)
                .flatMap(module => module.permissions)
                .map(p => p.id);

            // Create admin user document
            const adminData = {
                name: "Administrator",
                email: adminEmail,
                role: "admin",
                status: "active",
                permissions: allPermissions,
                createdAt: new Date(),
                emailVerified: true,
                lastLogin: new Date(),
                uid: auth.currentUser?.uid
            };

            // Add admin user to Firestore
            await setDoc(doc(db, "users", auth.currentUser?.uid || 'admin'), adminData);
            console.log("Admin user created successfully");
            return true;
        } else {
            // Update existing admin user with all permissions
            const adminDoc = userSnapshot.docs[0];
            const allPermissions = Object.values(modulePermissions)
                .flatMap(module => module.permissions)
                .map(p => p.id);

            await setDoc(doc(db, "users", adminDoc.id), {
                ...adminDoc.data(),
                role: "admin",
                status: "active",
                permissions: allPermissions,
                emailVerified: true,
                updatedAt: new Date()
            }, { merge: true });
            console.log("Admin user updated successfully");
            return true;
        }
    } catch (error) {
        console.error("Error setting up admin user:", error);
        return false;
    }
} 