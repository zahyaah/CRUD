document.addEventListener("DOMContentLoaded", () => {
    const table = document.querySelector(".updateTable");
    const formContainer = document.getElementById("formContainer");
    const editForm = document.getElementById("editForm");

    table.addEventListener("click", (event) => {
        const targetRow = event.target.closest("tr");

        if (targetRow && targetRow.rowIndex > 0) {
            const cells = targetRow.children;

            document.getElementById("editId").value = cells[0].textContent;
            document.getElementById("editName").value = cells[1].textContent;
            document.getElementById("editDesc").value = cells[2].textContent;
            document.getElementById("editPrice").value = cells[3].textContent;
            document.getElementById("editCat").value = cells[4].textContent;
            document.getElementById("editStock").value = cells[5].textContent;
            document.getElementById("editManf").value = cells[6].textContent;
            document.getElementById("editRel").value = cells[7].textContent;
            document.getElementById("editRating").value = cells[8].textContent;
        }
    });


    editForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const updatedProduct = {
            id: document.getElementById("editId").value,
            name: document.getElementById("editName").value,
            description: document.getElementById("editDesc").value,
            price: document.getElementById("editPrice").value,
            category: document.getElementById("editCat").value,
            stock_quantity: document.getElementById("editStock").value,
            manufacturer: document.getElementById("editManf").value,
            release_date: document.getElementById("editRel").value,
            rating: document.getElementById("editRating").value
        };

        try {
            const response = await fetch(`/products/${updatedProduct.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(updatedProduct)
            });

            if (response.ok) {
                alert("Product successfully updated!");
                formContainer.style.display = "none"; 
                location.reload(true);
            } else {
                const errorData = await response.json();
                alert(`Error updating product: ${errorData.message}`);
            }
        } catch (error) {
            console.error("Error updating product:", error);
            alert("An unexpected error occurred. Please try again later.");
        }
    });
});
