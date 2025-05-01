import { fixAdminPermissions } from '../app/users/fix-permissions';

async function main() {
    try {
        const success = await fixAdminPermissions("lgn9GWr1kIdq5Ai7wFGaSKXPHCf1");
        console.log("Admin fix result:", success);
        process.exit(0);
    } catch (error) {
        console.error("Error running admin fix:", error);
        process.exit(1);
    }
}

main(); 