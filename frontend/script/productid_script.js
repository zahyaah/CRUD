document.addEventListener("DOMContentLoaded", () => {
    const popup = document.getElementById('popup');
    if (popup) {
        popup.style.display = 'block';
        setTimeout(() => {
            popup.style.display = 'none';
        }, 3000);
    }

    const table = document.querySelector(".tableContainer");
    const card = document.querySelector(".overlay");

    table.addEventListener("click", (event) => {
        const targetRow = event.target.closest("tr");

        if (targetRow && targetRow.rowIndex > 0) {
            const cells = targetRow.children;
            fetchtheDetail(parseInt(cells[0].textContent));
        }
    });

    async function fetchtheDetail(id) {
        try {
            const store = await fetch(`/products/${id}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json"
                }
            });
            const data = await store.json();

            if (card) {
                card.style.display = "flex";
                document.getElementById("id").textContent = data[0].id; 
                document.getElementById("name").textContent = data[0].name; 
                document.getElementById("description").textContent = data[0].description; 
                document.getElementById("price").textContent = data[0].price; 
                document.getElementById("category").textContent = data[0].category; 
                document.getElementById("stock").textContent = data[0].stock_quantity; 
                document.getElementById("manf").textContent = data[0].manufacturer; 
                document.getElementById("rel").textContent = data[0].release_date.slice(0, 10); 
                document.getElementById("rating").textContent = data[0].rating;

                document.querySelector('.close-button').addEventListener('click', function() {
                    card.style.display = 'none';
                });
            }
        } catch (err) {
            console.error({"Error": "Can't fetch!"});
        }
    }
});
