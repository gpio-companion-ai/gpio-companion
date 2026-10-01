export type ModelScene = {
	zoomBy: (factor: number) => void;
	fit: () => void;
	dispose: () => void;
};

export async function mountModelScene(
	canvas: HTMLCanvasElement,
	bytes: Uint8Array,
): Promise<ModelScene> {
	const THREE = await import("three");
	const { OrbitControls } = await import(
		"three/addons/controls/OrbitControls.js"
	);
	const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: true,
	});
	renderer.setClearColor(0x000000, 0);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
	const ambient = new THREE.AmbientLight(0xffffff, 0.45);
	const key = new THREE.DirectionalLight(0xfff8f0, 0.9);
	key.position.set(2.2, 3.4, 4);
	const fill = new THREE.DirectionalLight(0xe7edf2, 0.28);
	fill.position.set(-3, 1.2, -2);
	scene.add(ambient, key, fill);

	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	const gltf = await new GLTFLoader().parseAsync(copy, "");
	let meshes = 0;
	gltf.scene.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) {
			return;
		}
		meshes += 1;
		if (!obj.geometry.getAttribute("normal")) {
			obj.geometry.computeVertexNormals();
		}
		obj.material = new THREE.MeshStandardMaterial({
			color: 0xffffff,
			metalness: 0.04,
			roughness: 0.78,
			vertexColors: Boolean(obj.geometry.getAttribute("color")),
		});
	});
	if (meshes === 0) {
		renderer.dispose();
		throw new Error("no mesh");
	}
	scene.add(gltf.scene);

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.screenSpacePanning = true;

	const fit = () => {
		const box = new THREE.Box3().setFromObject(gltf.scene);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z, 0.001);
		const fov = (camera.fov * Math.PI) / 180;
		const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.45;
		camera.near = maxDim / 100;
		camera.far = maxDim * 100;
		camera.position.set(
			center.x + dist * 0.55,
			center.y + dist * 0.42,
			center.z + dist,
		);
		camera.lookAt(center);
		controls.target.copy(center);
		controls.minDistance = maxDim * 0.2;
		controls.maxDistance = maxDim * 12;
		controls.update();
	};

	const resize = () => {
		const parent = canvas.parentElement;
		const width = Math.max(parent?.clientWidth || canvas.clientWidth || 1, 1);
		const height = Math.max(
			parent?.clientHeight || canvas.clientHeight || 1,
			1,
		);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	};

	const observer = new ResizeObserver(() => {
		resize();
	});
	if (canvas.parentElement) {
		observer.observe(canvas.parentElement);
	}
	resize();
	fit();

	let frameId = 0;
	let stopped = false;
	const loop = () => {
		if (stopped) {
			return;
		}
		controls.update();
		renderer.render(scene, camera);
		frameId = requestAnimationFrame(loop);
	};
	loop();

	const onDoubleClick = () => {
		fit();
	};
	canvas.addEventListener("dblclick", onDoubleClick);

	return {
		zoomBy(factor: number) {
			const offset = camera.position.clone().sub(controls.target);
			const next = Math.min(
				Math.max(offset.length() * factor, controls.minDistance),
				controls.maxDistance,
			);
			if (offset.lengthSq() === 0) {
				return;
			}
			offset.setLength(next);
			camera.position.copy(controls.target).add(offset);
			controls.update();
		},
		fit,
		dispose() {
			stopped = true;
			cancelAnimationFrame(frameId);
			canvas.removeEventListener("dblclick", onDoubleClick);
			observer.disconnect();
			controls.dispose();
			renderer.dispose();
			scene.traverse((obj) => {
				if (!(obj instanceof THREE.Mesh)) {
					return;
				}
				obj.geometry.dispose();
				const material = obj.material;
				if (Array.isArray(material)) {
					for (const item of material) {
						item.dispose();
					}
					return;
				}
				material.dispose();
			});
		},
	};
}
