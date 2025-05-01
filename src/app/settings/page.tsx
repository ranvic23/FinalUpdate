"use client";

import { useState, useEffect } from "react";
import { auth } from "../firebase-config";
import { updatePassword, updateProfile } from "firebase/auth";
import ProtectedRoute from "@/app/components/protectedroute";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";

export default function Settings() {
    const [user, setUser] = useState({ name: "", email: "", password: "" });
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        const currentUser = auth.currentUser;
        if (currentUser) {
            setUser({ 
                name: currentUser.displayName || "", 
                email: currentUser.email || "", 
                password: "" 
            });
        }
    }, []);

    const reauthenticateUser = async (password: string) => {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("No user is signed in.");

        const credential = EmailAuthProvider.credential(currentUser.email!, password);
        await reauthenticateWithCredential(currentUser, credential);
    };

    const handleUpdateProfile = async () => {
        try {
            if (auth.currentUser) {
                await updateProfile(auth.currentUser, { displayName: user.name });
                alert("Profile updated successfully!");
            }
        } catch (error) {
            console.error("Error updating profile:", error);
            alert("Failed to update profile. Please try again.");
        }
    };

    const handleChangePassword = async () => {
        try {
            const password = prompt("Enter your current password to confirm password change:");
            if (!password) return alert("Password confirmation is required.");

            await reauthenticateUser(password);
            await updatePassword(auth.currentUser!, user.password);

            alert("Password changed successfully!");
            setUser({ ...user, password: "" });
        } catch (error) {
            console.error("Error changing password:", error);
            alert("Failed to change password. Please try again.");
        }
    };

    return (
        <ProtectedRoute>
            <div className="p-8 bg-gray-100 min-h-screen">
                <h1 className="text-4xl font-bold text-gray-800 mb-6 text-center">Settings</h1>

                <div className="bg-white p-6 rounded-lg shadow-lg mb-6">
                    <h2 className="text-2xl font-bold mb-4">My Profile</h2>
                    <p className="mb-2"><strong>Name:</strong> {user.name}</p>
                    <p className="mb-2"><strong>Email:</strong> {user.email}</p>
                    <button 
                        onClick={() => setIsEditing(!isEditing)} 
                        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    >
                        {isEditing ? "Cancel" : "Edit Profile"}
                    </button>
                </div>

                {isEditing && (
                    <div className="bg-white p-6 rounded-lg shadow-lg mb-6">
                        <h2 className="text-2xl font-bold mb-4">Edit Profile</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    className="w-full p-2 border rounded"
                                    value={user.name}
                                    onChange={(e) => setUser({ ...user, name: e.target.value })}
                                />
                            </div>
                            <button 
                                onClick={handleUpdateProfile} 
                                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 w-full"
                            >
                                Update Profile
                            </button>
                        </div>

                        <div className="mt-8 space-y-4">
                            <h2 className="text-2xl font-bold mb-4">Change Password</h2>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                                <input
                                    type="password"
                                    className="w-full p-2 border rounded"
                                    placeholder="Enter new password"
                                    value={user.password}
                                    onChange={(e) => setUser({ ...user, password: e.target.value })}
                                />
                            </div>
                            <button 
                                onClick={handleChangePassword} 
                                className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 w-full"
                            >
                                Change Password
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
