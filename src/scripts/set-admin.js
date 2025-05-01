const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
const serviceAccount = {
    "type": "service_account",
    "project_id": "bbnka-mobile",
    "private_key_id": "your-private-key-id",
    "private_key": "your-private-key",
    "client_email": "firebase-adminsdk-xxxxx@bbnka-mobile.iam.gserviceaccount.com",
    "client_id": "your-client-id",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40bbnka-mobile.iam.gserviceaccount.com"
};

// Initialize the app
const app = initializeApp({
    credential: cert(serviceAccount)
});

// Get Firestore instance
const db = getFirestore();

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

async function setupSpecificAdmin(uid) {
    try {
        // Get all permissions
        const allPermissions = Object.values(modulePermissions)
            .flatMap(module => module.permissions)
            .map(p => p.id);

        // Get existing user data
        const userDoc = await db.collection('users').doc(uid).get();
        const existingData = userDoc.exists ? userDoc.data() : {};

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
        await db.collection('users').doc(uid).set(adminData, { merge: true });
        console.log("Admin user updated successfully");
        return true;
    } catch (error) {
        console.error("Error setting up admin user:", error);
        return false;
    }
}

// Set up the specific user as admin
setupSpecificAdmin("lgn9GWr1kIdq5Ai7wFGaSKXPHCf1")
    .then(success => {
        console.log("Admin setup completed:", success);
        process.exit(0);
    })
    .catch(error => {
        console.error("Error:", error);
        process.exit(1);
    }); 