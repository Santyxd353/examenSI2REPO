import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RotateCcw, Plus, Minus, Move3D } from 'lucide-react';
type Props = {
  bodyUrl: string | null;
  garmentUrl?: string | null;
  color?: string;
  reference?: boolean;
};
export function Viewer({ bodyUrl, garmentUrl, color = '#e9e4d8', reference = true }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [status, setStatus] = useState('Cargando modelo…');
  useEffect(() => {
    const el = host.current!;
    let disposed = false,
      frame = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('Tu navegador no pudo iniciar la vista 3D.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(2.1, 1.25, 3.5);
    cameraRef.current = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.target.set(0, 0.87, 0);
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b8d80, 2.5));
    const key = new THREE.DirectionalLight(0xfff1dc, 3);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.02;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.4);
    fill.position.set(-4, 2, -2);
    scene.add(fill);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.53, 0.56, 0.045, 80),
      new THREE.MeshStandardMaterial({ color: 0xd8d7ce, roughness: 0.95 }),
    );
    base.position.y = -0.024;
    base.receiveShadow = true;
    scene.add(base);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
    const loader = new GLTFLoader();
    setStatus('Cargando modelo…');
    async function load() {
      try {
        if (bodyUrl) {
          const body = await loader.loadAsync(bodyUrl);
          if (disposed) return;
          body.scene.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          scene.add(body.scene);
        }
        if (garmentUrl) {
          const garment = await loader.loadAsync(garmentUrl);
          if (disposed) return;
          garment.scene.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.castShadow = true;
              o.material = new THREE.MeshStandardMaterial({
                color,
                roughness: 0.92,
                side: THREE.DoubleSide,
              });
            }
          });
          scene.add(garment.scene);
        }
        setStatus('');
      } catch {
        if (!disposed) setStatus('El modelo aún no está disponible.');
      }
    }
    void load();
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    function draw() {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [bodyUrl, garmentUrl, color]);
  const reset = () => {
    cameraRef.current?.position.set(2.1, 1.25, 3.5);
    controlsRef.current?.target.set(0, 0.87, 0);
  };
  const zoom = (factor: number) => {
    const c = cameraRef.current,
      t = controlsRef.current?.target;
    if (c && t) c.position.sub(t).multiplyScalar(factor).add(t);
  };
  return (
    <div className="viewer-shell">
      <div className="viewer-label">
        <span className="live-dot" />
        {!bodyUrl
          ? 'Silueta de la prenda'
          : reference
            ? 'Modelo de referencia'
            : 'Tu avatar personal'}
      </div>
      <div
        ref={host}
        className="canvas"
        role="img"
        aria-label="Modelo 3D interactivo. Arrastra para girar; usa los botones para acercar."
      />
      {status && (
        <div role="status" className="viewer-status">
          {status}
        </div>
      )}
      <div className="viewer-hint">
        <Move3D size={16} /> Arrastra para explorar en 360°
      </div>
      <div className="viewer-controls">
        <button aria-label="Acercar modelo" onClick={() => zoom(0.85)}>
          <Plus size={17} />
        </button>
        <button aria-label="Alejar modelo" onClick={() => zoom(1.15)}>
          <Minus size={17} />
        </button>
        <button aria-label="Restablecer cámara" onClick={reset}>
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="coordinate">VISTA 3D / 01</div>
    </div>
  );
}
