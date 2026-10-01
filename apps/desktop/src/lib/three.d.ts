declare module "three" {
	export class Vector3 {
		x: number;
		y: number;
		z: number;
		constructor(x?: number, y?: number, z?: number);
		set(x: number, y: number, z: number): this;
		copy(v: Vector3): this;
		clone(): Vector3;
		sub(v: Vector3): this;
		add(v: Vector3): this;
		setLength(length: number): this;
		length(): number;
		lengthSq(): number;
	}
	export class Box3 {
		setFromObject(object: Object3D): this;
		getSize(target: Vector3): Vector3;
		getCenter(target: Vector3): Vector3;
	}
	export class Object3D {
		position: Vector3;
		traverse(callback: (object: Object3D) => void): void;
		add(...objects: Object3D[]): this;
	}
	export class Scene extends Object3D {}
	export class Camera extends Object3D {}
	export class PerspectiveCamera extends Camera {
		constructor(fov?: number, aspect?: number, near?: number, far?: number);
		fov: number;
		aspect: number;
		near: number;
		far: number;
		lookAt(target: Vector3): void;
		updateProjectionMatrix(): void;
	}
	export class Light extends Object3D {}
	export class AmbientLight extends Light {
		constructor(color?: number, intensity?: number);
	}
	export class DirectionalLight extends Light {
		constructor(color?: number, intensity?: number);
	}
	export class Material {
		dispose(): void;
	}
	export class MeshStandardMaterial extends Material {
		constructor(params?: object);
	}
	export class BufferGeometry {
		getAttribute(name: string): unknown | undefined;
		computeVertexNormals(): void;
		dispose(): void;
	}
	export class Mesh extends Object3D {
		geometry: BufferGeometry;
		material: Material | Material[];
	}
	export class WebGLRenderer {
		constructor(params?: {
			canvas?: HTMLCanvasElement;
			antialias?: boolean;
			alpha?: boolean;
		});
		setClearColor(color: number, alpha?: number): void;
		setPixelRatio(value: number): void;
		setSize(width: number, height: number, updateStyle?: boolean): void;
		outputColorSpace: string;
		render(scene: Scene, camera: Camera): void;
		dispose(): void;
	}
	export const SRGBColorSpace: string;
}

declare module "three/addons/controls/OrbitControls.js" {
	import type { Camera, Vector3 } from "three";
	export class OrbitControls {
		constructor(camera: Camera, domElement?: HTMLElement);
		enableDamping: boolean;
		dampingFactor: number;
		screenSpacePanning: boolean;
		target: Vector3;
		minDistance: number;
		maxDistance: number;
		update(): void;
		dispose(): void;
	}
}

declare module "three/addons/loaders/GLTFLoader.js" {
	import type { Object3D } from "three";
	export class GLTFLoader {
		parseAsync(
			data: ArrayBuffer,
			path: string,
		): Promise<{ scene: Object3D }>;
	}
}
