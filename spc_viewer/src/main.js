import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 1.5);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const loader = new PLYLoader();

let currentJSON = null;
const patchColorMap = {};

// Close popup button logic
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('close-popup').onclick = () => {
    document.getElementById('patch-popup').style.display = 'none';
  };
});

document.getElementById('close-popup').onclick = () => {
  document.getElementById('patch-popup').style.display = 'none';
};

loader.load('/HK_id_refined.ply', (geometry) => {
  geometry.computeVertexNormals();

  const patchIds = [];
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const originalColors = [];

  for (let i = 0; i < color.count; i++) {
    originalColors.push(color.getX(i), color.getY(i), color.getZ(i));
  }

  fetch('/HK_id_refined.ply')
    .then(res => res.text())
    .then(text => {
      const lines = text.split('\n');
      const headerEnd = lines.findIndex(line => line.trim() === 'end_header');
      const body = lines.slice(headerEnd + 1);

      for (let i = 0; i < position.count; i++) {
        const line = body[i];
        const cols = line.trim().split(/\s+/);
        const patchId = parseInt(cols[9]);
        patchIds.push(isNaN(patchId) ? 0 : patchId);
      }

      const patchCenters = {};
      const patchPointCounts = {};
      const positions = [];
      const colors = [];

      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const patchId = patchIds[i];

        positions.push(x, y, z);
        colors.push(originalColors[i * 3], originalColors[i * 3 + 1], originalColors[i * 3 + 2]);

        if (!patchCenters[patchId]) {
          patchCenters[patchId] = new THREE.Vector3();
          patchPointCounts[patchId] = 0;
        }
        patchCenters[patchId].add(new THREE.Vector3(x, y, z));
        patchPointCounts[patchId]++;
      }

      for (const id in patchCenters) {
        patchCenters[id].divideScalar(patchPointCounts[id]);
      }

      const newGeom = new THREE.BufferGeometry();
      newGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      newGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({ size: 0.01, vertexColors: true });
      const points = new THREE.Points(newGeom, material);
      points.userData.patchIds = patchIds;
      scene.add(points);

      const highlightSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.02),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      highlightSphere.visible = false;
      scene.add(highlightSphere);

      const raycaster = new THREE.Raycaster();
      raycaster.params.Points.threshold = 0.02;
      const mouse = new THREE.Vector2();

      window.addEventListener('click', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(points);

        if (intersects.length > 0) {
          const idx = intersects[0].index;
          const patchId = points.userData.patchIds[idx];

          const patchCenter = patchCenters[patchId];
          if (patchCenter) {
            highlightSphere.position.copy(patchCenter);
            highlightSphere.visible = true;
          }

          if (patchId === undefined || isNaN(patchId)) return;

          fetch('/HK_full_description.json')
            .then(res => res.json())
            .then(data => {
              currentJSON = data;
              const patch = data.patches[String(patchId)];
              if (!patch) return;

              let content = `<strong>Patch ID:</strong> ${patchId}<br/>`;
              if (patch.material) content += `<strong>Material:</strong> ${patch.material.materialType}<br/>`;
              if (patch.structure) content += `<strong>Structure:</strong> ${patch.structure.structuralRole}<br/>`;
              if (patch.culturalAndArtist?.decorativeElements) {
                const deco = patch.culturalAndArtist.decorativeElements;
                if (typeof deco === 'object') {
                  content += `<strong>Decorative Element:</strong> ${deco.type}<br/><em>${deco.description}</em><br/>`;
                } else {
                  content += `<strong>Decorative Element:</strong> ${deco}<br/>`;
                }
              }

              const popup = document.getElementById('patch-popup');
              const contentDiv = document.getElementById('patch-content');
              contentDiv.innerHTML = content;
              popup.style.display = 'block';
            });
        }
      });

      fetch('/HK_full_description.json')
        .then(res => res.json())
        .then(data => {
          currentJSON = data;
          const obj = data.heritageObject;
          const panel = document.getElementById('heritage-info');

          const location = `${obj.location.address}, ${obj.location.neighborhood}`;
          const material = Array.isArray(obj.material.materialType)
            ? obj.material.materialType.join(', ')
            : obj.material.materialType;

          panel.innerHTML = `
            <strong>Name:</strong> ${obj.name}<br/>
            <strong>Location:</strong> ${location}<br/>
            <strong>Artist:</strong> ${obj.culturalAndArtist.artistName}<br/>
            <strong>Year:</strong> ${obj.yearOfPlacement}<br/>
            <strong>Material:</strong> ${material}<br/><br/>
            <strong>History:</strong><br/>
            ${obj.historical.buildingOrigin}<br/><br/>
            <strong>Documents:</strong><br/>
            <ul>
              ${obj.historical.historicalDocuments.map(d =>
                d.startsWith('http') ? `<li><a href="${d}" target="_blank">Link</a></li>` : `<li>${d}</li>`
              ).join('')}
            </ul>`;
        });

      function applyColorByMode(mode, json) {
        const newColors = [];

        for (let i = 0; i < patchIds.length; i++) {
          const patchId = patchIds[i];
          let key = '';

          if (mode === 'original') {
            newColors.push(originalColors[i * 3], originalColors[i * 3 + 1], originalColors[i * 3 + 2]);
            continue;
          }
          if (mode === 'structure') key = json.patches[String(patchId)]?.structure?.structuralRole;
          if (mode === 'material') key = json.patches[String(patchId)]?.material?.materialType;
          if (mode === 'patch') key = patchId;

          if (!key) key = 'default';
          if (!patchColorMap[key]) patchColorMap[key] = new THREE.Color().setHSL(Math.random(), 0.5, 0.5);

          const col = patchColorMap[key];
          newColors.push(col.r, col.g, col.b);
        }

        newGeom.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
      }

      document.getElementById('view-original').onclick = () => applyColorByMode('original', currentJSON);
      document.getElementById('view-patch').onclick = () => applyColorByMode('patch', currentJSON);
      document.getElementById('view-material').onclick = () => applyColorByMode('material', currentJSON);
      document.getElementById('view-structure').onclick = () => applyColorByMode('structure', currentJSON);

      animate();
    });
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (animate.labelUpdaters) animate.labelUpdaters.forEach(fn => fn());
  renderer.render(scene, camera);
}