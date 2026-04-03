class NotesPanel extends HTMLElement {
    constructor() {
        super();
        this.t = {};
    }

    async connectedCallback() {
        await this.loadLanguage();
        this.render();
    }

    async loadLanguage() {
        const lang = document.documentElement.lang || 'en';
        try {
            const response = await fetch(`./languages/${lang}.json`);
            if (!response.ok) throw new Error();
            this.t = await response.json();
        } catch (e) {
            const fallback = await fetch(`./languages/en.json`);
            this.t = await fallback.json();
        }
        
        document.title = this.t.panel_title || "Notes";
    }

    render() {
        const styles = getComputedStyle(document.documentElement);
        const haPrimary = styles.getPropertyValue('--primary-color');
        const haAccent = styles.getPropertyValue('--accent-color');

        const shadow = this.attachShadow({ mode: "open" });

        if (haPrimary) this.style.setProperty('--primary-color', haPrimary);
        if (haAccent) this.style.setProperty('--accent-color', haAccent);

        shadow.innerHTML = `
            <link rel="stylesheet" href="styles.css">
            <style>
                :host {
                    display: block;
                    height: 100%;
                    padding: 20px;
                    background-color: var(--primary-background-color);
                    color: var(--primary-text-color);
                    font-family: var(--primary-font-family, Roboto, Arial, sans-serif);
                }
            </style>
            <button id="create-note">${this.t.create_note}</button>
            <ul id="notes-list"></ul>

            <div id="admin-section" class="admin-tools" style="display: none;">
                <button id="btn-check-files" class="tool-btn">${this.t.admin_check_files}</button>
                <button id="btn-cleanup" class="tool-btn">${this.t.admin_cleanup}</button>
            </div>
        `;

        this.initNotes(shadow);
    }

    initNotes(shadow) {
        const notesList = shadow.getElementById("notes-list");
        const createButton = shadow.getElementById("create-note");

        const truncateText = (text, maxLength) => {
            if (!text) return "";
            return text.length <= maxLength
                ? text.replace(/\n/g, "<br>")
                : text.slice(0, maxLength).replace(/\n/g, "<br>") + " <span class='read-more'>…</span>";
        };

        const fetchNotes = async () => {
            try {
                const response = await fetch("./api/notes");
                const data = await response.json();
                if (!Array.isArray(data)) return;

                notesList.innerHTML = "";
                data.forEach(note => {
                    const noteCard = document.createElement("div");
                    noteCard.className = "note-card";

                    const contentDiv = document.createElement("div");
                    contentDiv.className = "note-content";
                    contentDiv.innerHTML = truncateText(note.content, 300);

                    const imageContainer = document.createElement("div");
                    imageContainer.className = "image-container";

                    if (note.images && Array.isArray(note.images)) {
                        note.images.forEach(url => {
                            const img = document.createElement("img");
                            img.src = url;
                            img.className = "thumbnail";
                            imageContainer.appendChild(img);
                        });
                    }

                    const buttons = document.createElement("div");
                    buttons.className = "buttons";
                    buttons.innerHTML = `
                        <button class="edit" title="${this.t.edit_hint}">✏️</button>
                        <button class="delete" title="${this.t.delete_hint}">🗑️</button>
                    `;
                    
                    buttons.querySelector(".edit").onclick = (e) => {
                        e.stopPropagation();
                        this.openEditor(shadow, fetchNotes, note.id, note.content, note.images);
                    };
                    buttons.querySelector(".delete").onclick = (e) => {
                        e.stopPropagation();
                        this.deleteNote(note.id, fetchNotes);
                    };

                    contentDiv.onclick = () => this.openViewer(shadow, note);

                    contentDiv.appendChild(imageContainer);
                    noteCard.appendChild(contentDiv);
                    noteCard.appendChild(buttons);
                    notesList.appendChild(noteCard);
                });
            } catch (error) {
                console.error(this.t.loading_error, error);
            }
        };

        createButton.onclick = () => this.openEditor(shadow, fetchNotes);
        fetchNotes();

        const checkAdminConfig = async () => {
            try {
                const res = await fetch("./api/config");
                const config = await res.json();
                
                if (config.show_admin_tools) {
                    shadow.getElementById("admin-section").style.display = "flex";
                    
                }
            } catch (e) {
                console.log("Config not found, hiding admin tools.");
            }
        };

        checkAdminConfig();

        const btnCheck = shadow.getElementById("btn-check-files");
        const btnCleanup = shadow.getElementById("btn-cleanup");

        btnCheck.onclick = async () => {
            const res = await fetch("./api/check_files");
            const data = await res.json();
            const fileList = data.total_files > 0 
                ? `<ul class="admin-file-list">${data.files_found.map(f => `<li>${f}</li>`).join('')}</ul>`
                : `<p>${this.t.admin_no_files}</p>`;
            
            this.openInfoModal(shadow, `${this.t.admin_check_files} (${data.total_files})`, fileList);
        };

        btnCleanup.onclick = async () => {
            const res = await fetch("./api/cleanup_images");
            const data = await res.json();
            
            if (data.orphaned_count === 0) {
                this.openInfoModal(shadow, this.t.admin_cleanup, this.t.admin_no_files);
                return;
            }

            const msg = this.t.admin_orphans_found.replace("{count}", data.orphaned_count);
            const content = `
                <p>${msg}</p>
                <button id="confirm-delete" class="delete-confirm-btn">${this.t.admin_confirm_delete}</button>
            `;
            
            const modal = this.openInfoModal(shadow, this.t.admin_cleanup, content);
            
            modal.querySelector("#confirm-delete").onclick = async () => {
                const delRes = await fetch("./api/cleanup_images?confirm=true");
                const delData = await delRes.json();
                shadow.removeChild(modal);
                
                const successMsg = this.t.admin_delete_success.replace("{count}", delData.count);
                this.openInfoModal(shadow, "OK", successMsg);
            };
        };
    }

    openViewer(shadow, note) {
        const modal = document.createElement("div");
        modal.className = "modal";
        const imagesHtml = (note.images && note.images.length > 0)
            ? `<div class="image-container">${note.images.map(url => `<img src="${url}" class="thumbnail zoomable">`).join("")}</div>`
            : "";

        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-window">
                <div class="modal-content">
                    <pre style="white-space: pre-wrap;">${note.content}</pre>
                    ${imagesHtml}
                    <button class="modal-close">✖</button>
                </div>
            </div>
        `;
        shadow.appendChild(modal);
        modal.querySelector(".modal-close").onclick = 
        modal.querySelector(".modal-backdrop").onclick = () => shadow.removeChild(modal);

        modal.querySelectorAll(".zoomable").forEach(img => {
            img.onclick = () => {
                const zoom = document.createElement("div");
                zoom.className = "zoom-viewer";
                zoom.innerHTML = `
                    <div class="zoom-backdrop"></div>
                    <div class="zoom-image-wrapper">
                        <img src="${img.src}" />
                        <button class="zoom-close">✖</button>
                    </div>
                `;
                shadow.appendChild(zoom);
                zoom.querySelector(".zoom-close").onclick = 
                zoom.querySelector(".zoom-backdrop").onclick = () => shadow.removeChild(zoom);
            };
        });
    }

    async openEditor(shadow, refreshCallback, id = null, content = "", images = []) {
        const editor = document.createElement("div");
        editor.className = "modal";
        editor.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-window">
                <div class="modal-content">
                    <textarea id="note-editor">${content}</textarea>
                    <div class="upload-section">
                        <label for="image-upload" class="custom-file-upload">📁 ${this.t.upload_images}</label>
                        <input type="file" id="image-upload" accept="image/*" multiple style="display:none">
                    </div>
                    <div id="preview-container" class="image-container"></div>
                    <div class="modal-buttons">
                        <button id="save-note">💾 ${this.t.save}</button>
                        <button id="cancel-note">❌ ${this.t.cancel}</button>
                    </div>
                </div>
            </div>
        `;
        shadow.appendChild(editor);

        const preview = editor.querySelector("#preview-container");
        const newImages = [];
        const currentImages = [...images];

        const addPreview = (url, isTemp) => {
            const wrapper = document.createElement("div");
            wrapper.className = "preview-wrapper";
            wrapper.innerHTML = `<img src="${url}" class="thumbnail"><span class="remove-img">✖</span>`;
            wrapper.querySelector(".remove-img").onclick = async () => {
                preview.removeChild(wrapper);
                if (isTemp) {
                    await fetch(`./api/notes/upload?path=${encodeURIComponent(url)}`, { method: "DELETE" });
                    newImages.splice(newImages.indexOf(url), 1);
                } else {
                    currentImages.splice(currentImages.indexOf(url), 1);
                }
            };
            preview.appendChild(wrapper);
        };

        currentImages.forEach(url => addPreview(url, false));

        editor.querySelector("#image-upload").onchange = async (e) => {
            const input = e.target;
            if (!input.files || input.files.length === 0) return;

            for (const file of input.files) {
                const fd = new FormData();
                fd.append("file", file);
                try {
                    const res = await fetch("./api/notes/upload", { method: "POST", body: fd });
                    const data = await res.json();
                    if (data.url) {
                        const cleanUrl = data.url.replace(/^\.\//, '');
                        newImages.push(cleanUrl);
                        addPreview(cleanUrl, true);
                    }
                } catch (error) {
                    console.error("Upload failed:", error);
                }
            }
            input.value = "";
        };

        editor.querySelector("#cancel-note").onclick = async () => {
            for (const url of newImages) await fetch(`./api/notes/upload?path=${encodeURIComponent(url)}`, { method: "DELETE" });
            shadow.removeChild(editor);
        };

        editor.querySelector("#save-note").onclick = async () => {
            const body = { content: editor.querySelector("#note-editor").value, images: [...currentImages, ...newImages] };
            await fetch(id ? `./api/notes/${id}` : "./api/notes", {
                method: id ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            shadow.removeChild(editor);
            refreshCallback();
        };
    }

    openInfoModal(shadow, title, htmlContent) {
        const modal = document.createElement("div");
        modal.className = "modal";
        modal.innerHTML = `
        <div class="modal-backdrop"></div>
            <div class="modal-window admin-modal">
                <div class="modal-content">
                    <h3>${title}</h3>
                    <div class="info-scroll-area">
                        ${htmlContent}
                    </div>
                    <div class="modal-buttons">
                        <button class="modal-close-btn">${this.t.modal_close}</button>
                    </div>
                </div>
            </div>
        `;
        shadow.appendChild(modal);
        
        const close = () => shadow.removeChild(modal);
        modal.querySelector(".modal-close-btn").onclick = close;
        modal.querySelector(".modal-backdrop").onclick = close;
        
        return modal;
    }

    async deleteNote(id, refreshCallback) {
        if (confirm(this.t.delete_confirm)) {
            await fetch(`./api/notes/${id}`, { method: "DELETE" });
            refreshCallback();
        }
    }
}

customElements.define("notes-panel", NotesPanel);