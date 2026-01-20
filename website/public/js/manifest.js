// Load and display firmware versions from manifest.json

async function loadVersions() {
    try {
        const response = await fetch('js/manifest.json');
        const data = await response.json();
        
        const container = document.getElementById('versions-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!data.versions || data.versions.length === 0) {
            container.innerHTML = '<p>No firmware versions available yet.</p>';
            return;
        }
        
        data.versions.forEach(version => {
            const versionElement = createVersionElement(version);
            container.appendChild(versionElement);
        });
        
    } catch (error) {
        console.error('Failed to load versions:', error);
        const container = document.getElementById('versions-container');
        if (container) {
            container.innerHTML = '<p>Failed to load firmware versions. Please try again later or visit <a href="https://github.com/liptonj/Led-Matrix-Webex/releases" target="_blank">GitHub Releases</a>.</p>';
        }
    }
}

function createVersionElement(version) {
    const div = document.createElement('div');
    div.className = 'version-item';
    
    const header = document.createElement('div');
    header.className = 'version-header';
    
    const tag = document.createElement('div');
    tag.className = 'version-tag';
    tag.textContent = version.tag;
    
    const date = document.createElement('div');
    date.className = 'version-date';
    date.textContent = new Date(version.published).toLocaleDateString();
    
    header.appendChild(tag);
    header.appendChild(date);
    div.appendChild(header);
    
    if (version.notes) {
        const notes = document.createElement('p');
        notes.textContent = version.notes;
        div.appendChild(notes);
    }
    
    const downloadGrid = document.createElement('div');
    downloadGrid.className = 'download-grid';
    
    // Add download buttons for each asset
    const assetGroups = {
        'Bootstrap Firmware': ['bootstrap-esp32s3.bin', 'bootstrap-esp32.bin'],
        'Main Firmware': ['firmware-esp32s3.bin', 'firmware-esp32.bin'],
        'OTA Updates': ['firmware-ota-esp32s3.bin', 'firmware-ota-esp32.bin', 'bootstrap-ota-esp32s3.bin', 'bootstrap-ota-esp32.bin'],
        'Complete Packages': ['firmware-v', 'bootstrap-v', 'bridge-v']
    };
    
    Object.entries(assetGroups).forEach(([groupName, patterns]) => {
        const groupAssets = version.assets.filter(asset => 
            patterns.some(pattern => asset.name.includes(pattern))
        );
        
        if (groupAssets.length > 0) {
            const groupTitle = document.createElement('h4');
            groupTitle.textContent = groupName;
            div.appendChild(groupTitle);
            
            const groupGrid = document.createElement('div');
            groupGrid.className = 'download-grid';
            
            groupAssets.forEach(asset => {
                const link = document.createElement('a');
                link.href = asset.url;
                link.className = 'download-btn';
                link.textContent = asset.name;
                link.target = '_blank';
                groupGrid.appendChild(link);
            });
            
            div.appendChild(groupGrid);
        }
    });
    
    return div;
}

// Load versions when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadVersions);
} else {
    loadVersions();
}
