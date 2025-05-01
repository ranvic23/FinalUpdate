'use client';
import { useEffect, useState } from 'react';
import { checkAndFixAdminPermissions } from './check-admin';

export default function FixAdminPage() {
    const [status, setStatus] = useState<string>('Checking permissions...');

    useEffect(() => {
        const runCheck = async () => {
            try {
                await checkAndFixAdminPermissions();
                setStatus('Permission check complete. Please try accessing the Users module again.');
            } catch (error) {
                setStatus('Error checking permissions. Please try again.');
                console.error(error);
            }
        };

        runCheck();
    }, []);

    return (
        <div className="p-4">
            <h1 className="text-2xl font-bold mb-4">Admin Permission Check</h1>
            <p className="text-lg">{status}</p>
        </div>
    );
} 