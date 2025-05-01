import { auth, db } from "../firebase-config";
import { doc, getDoc } from "firebase/firestore";
import { setupAdminUser } from "./setup-admin";

export async function checkAndFixAdminPermissions() {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            console.log("No user is currently logged in");
            return;
        }

        // Get the user document
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        
        if (!userDoc.exists()) {
            console.log("User document not found, running admin setup...");
            await setupAdminUser(currentUser.email || "admin@gmail.com");
            return;
        }

        const userData = userDoc.data();
        console.log("Current user permissions:", userData.permissions);
        console.log("Current user role:", userData.role);

        // Check if user has all necessary permissions
        if (userData.role !== "admin" || !userData.permissions?.includes("view_users") || !userData.permissions?.includes("manage_users")) {
            console.log("Admin permissions missing, fixing...");
            await setupAdminUser(currentUser.email || "admin@gmail.com");
        } else {
            console.log("Admin permissions are correctly set");
        }
    } catch (error) {
        console.error("Error checking admin permissions:", error);
    }
} 