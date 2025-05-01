import { setupSpecificAdmin } from '../app/users/setup-specific-admin';

async function main() {
    try {
        const success = await setupSpecificAdmin("lgn9GWr1kIdq5Ai7wFGaSKXPHCf1");
        console.log("Admin setup result:", success);
        process.exit(0);
    } catch (error) {
        console.error("Error running admin setup:", error);
        process.exit(1);
    }
}

main(); 