"use client"; // Required for client-side hooks

import { useAuthState } from "react-firebase-hooks/auth";
import { auth, db } from "../firebase-config";
import { useRouter } from "next/navigation";
import { useEffect, ReactNode, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

interface ProtectedRouteProps {
  children: ReactNode;
  requiredPermissions?: string[];
}

export default function ProtectedRoute({ 
  children, 
  requiredPermissions = []
}: ProtectedRouteProps) {
  const [user, loading] = useAuthState(auth);
  const [isVerifying, setIsVerifying] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const verifyAccess = async () => {
      if (!user) {
        router.push("/");
        return;
      }

      // If no specific permissions are required, allow access
      if (requiredPermissions.length === 0) {
        setIsVerifying(false);
        setHasPermission(true);
        return;
      }

      try {
        // Get user document from Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();

        if (!userData) {
          setIsVerifying(false);
          setHasPermission(false);
          router.push("/unauthorized");
          return;
        }

        // Check if user is admin (admins have all permissions)
        if (userData.role === 'admin') {
          setIsVerifying(false);
          setHasPermission(true);
          return;
        }

        // If user is staff and trying to access restricted modules, redirect to unauthorized
        if (userData.role === 'staff' && 
            (requiredPermissions.includes('view_users') || 
             requiredPermissions.includes('manage_users') ||
             requiredPermissions.includes('view_reports') ||
             requiredPermissions.includes('export_reports') ||
             requiredPermissions.includes('view_content') ||
             requiredPermissions.includes('manage_promotions') ||
             requiredPermissions.includes('manage_announcements'))) {
          console.log('Staff attempting to access restricted content:', requiredPermissions);
          setIsVerifying(false);
          setHasPermission(false);
          router.push("/unauthorized");
          return;
        }

        // For staff, check specific permissions
        const hasRequiredPermissions = requiredPermissions.every(
          permission => userData.permissions?.includes(permission)
        );

        setHasPermission(hasRequiredPermissions);
        setIsVerifying(false);

        if (!hasRequiredPermissions) {
          console.log('User lacks required permissions:', requiredPermissions);
          router.push("/unauthorized");
        }
      } catch (error) {
        console.error("Error verifying permissions:", error);
        setIsVerifying(false);
        setHasPermission(false);
        router.push("/unauthorized");
      }
    };

    if (!loading) {
      verifyAccess();
    }
  }, [user, loading, router, requiredPermissions]);

  if (loading || isVerifying) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (hasPermission && !isVerifying) ? <>{children}</> : null;
}

//protected route is used to protect the dashboard page from unauthorized access.
//It checks if the user is authenticated using the useAuthState hook from react-firebase-hooks.