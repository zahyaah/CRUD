document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("product-form").addEventListener("submit", async (event) => {
        event.preventDefault();

        const id = parseInt(document.getElementById("proId").value);  
        const table = document.querySelector("tableContainter"); 
        
        if (isNaN(id) || id <= 0) {
            alert("Invalid ID: ID must be a positive number");
            return;
        }

        await deleteProduct(id);
    });

    async function deleteProduct(storeId) {
        try {
            const response = await fetch(`/products/${storeId}`, {
                method: "DELETE"
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Server error: ${errorData.message ?? "Product ID doesn't exist"}`);
            }

            alert("Product successfully deleted!");
            location.reload(true);
        } catch (error) {
            alert(`Error : ${error.message}`);
        }
    }
});

