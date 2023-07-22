// luma.gl, MIT license
import type {Device} from '../device';
import type {TypedArray} from '../../types';
import type {TextureFormat} from '../types/texture-formats';
import {Resource, ResourceProps} from './resource';
import {Sampler, SamplerProps} from './sampler';

/**
 * These represent the main compressed texture formats
 * Each format typically has a number of more specific subformats
 */
export type TextureCompressionFormat =
  | 'dxt'
  | 'dxt-srgb'
  | 'etc1'
  | 'etc2'
  | 'pvrtc'
  | 'atc'
  | 'astc'
  | 'rgtc';

/** Names of cube texture faces */
export type TextureCubeFace = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

/**
 * One mip level
 * Basic data structure is similar to `ImageData`
 * additional optional fields can describe compressed texture data.
 */
export type TextureLevelData = {
  /** WebGPU style format string. Defaults to 'rgba8unorm' */
  format?: TextureFormat;
  data: TypedArray;
  width: number;
  height: number;

  compressed?: boolean;
  byteLength?: number;
  hasAlpha?: boolean;
};

/**
 * Built-in data types that can be used to initialize textures
 * @note WebGL supports OffscreenCanvas but seems WebGPU does not?
 */
export type ExternalImage =
  | ImageData
  | ImageBitmap
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement;

export type TextureLevelSource = TextureLevelData | ExternalImage;

/** Texture data can be one or more mip levels */
export type TextureData = TextureLevelData | ExternalImage | (TextureLevelData | ExternalImage)[];

/** @todo - define what data type is supported for 1D textures */
export type Texture1DData = never;

/** Texture data can be one or more mip levels */
export type Texture2DData = TextureLevelData | ExternalImage | (TextureLevelData | ExternalImage)[];

/** Array of textures */
export type Texture3DData = TextureData[];

/** 6 face textures */
export type TextureCubeData = Record<TextureCubeFace, Texture2DData>;

/** Array of textures */
export type TextureArrayData = TextureData[];

/** Array of 6 face textures */
export type TextureCubeArrayData = Record<TextureCubeFace, TextureData>[];

/** Texture properties */
export type TextureProps = ResourceProps &
  (
    | Texture1DProps
    | Texture2DProps
    | Texture3DProps
    | TextureArrayProps
    | TextureCubeProps
    | TextureCubeArrayProps
  ) & {
    // dimension?: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
    // data?: TextureData | Promise<TextureData> | TextureCubeData | HTMLVideoElement | null | TextureData | TextureArrayData | Texture3DData | TextureCubeData | TextureCubeArrayData;

    format?: TextureFormat;
    width?: number | undefined;
    height?: number | undefined;
    depth?: number;
    usage?: number;

    /** Whether to automatically generate mipmaps from a single texture level */
    generateMipmaps?: boolean;
    /** Default sampler for this texture if no sampler provided. Note that other samplers can still be used. */
    sampler?: Sampler | SamplerProps;
    /** How many mip levels */
    mipLevels?: number;
    /** Multi sampling */
    samples?: number;
    compressed?: boolean;
    /** @deprecated Use .generateMipmaps */
    mipmaps?: boolean;
  };

/** @deprecated 1D textures not yet supported by luma.gl API */
type Texture1DProps = {dimension?: '1d'; data?: Texture1DData | Promise<Texture1DData> | null};
type Texture2DProps = {dimension?: '2d'; data?: Texture2DData | Promise<TextureData> | null};
type Texture3DProps = {dimension: '3d'; data?: Texture3DData | Promise<Texture3DData> | null};
// prettier-ignore
type TextureArrayProps = {dimension: '2d-array'; data?: TextureArrayData | Promise<TextureArrayData> | null};
// prettier-ignore
type TextureCubeProps = {dimension: 'cube'; data: TextureCubeData | Promise<TextureCubeData> | null};
// prettier-ignore
type TextureCubeArrayProps = {dimension: 'cube-array'; data: TextureCubeArrayData | Promise<TextureCubeArrayData> | null};

/** Not yet used - Views are automatically created for textures
export type TextureViewProps = {
  format: string;
  dimension: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
  aspect?: 'all' | 'stencil-only' | 'depth-only';
  arrayLayerCount: number;
  baseArrayLayer?: number;
  mipLevels?: number;
  baseMipLevel?: number;
};
*/

/**
 * Abstract Texture interface
 * Texture Object
 * https://gpuweb.github.io/gpuweb/#gputexture
 */
export abstract class Texture extends Resource<TextureProps> {
  static COPY_SRC = 0x01;
  static COPY_DST = 0x02;
  static TEXTURE_BINDING = 0x04;
  static STORAGE_BINDING = 0x08;
  static RENDER_ATTACHMENT = 0x10;

  static CubeFaces: TextureCubeFace[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

  static override defaultProps: Required<TextureProps> = {
    ...Resource.defaultProps,
    data: null,
    dimension: '2d',
    format: 'rgba8unorm',
    width: undefined!,
    height: undefined!,
    depth: 1,
    mipmaps: true,
    sampler: {},
    compressed: false,
    usage: 0,
    mipLevels: undefined!,
    samples: undefined!,
    generateMipmaps: true
  };

  override get [Symbol.toStringTag](): string {
    return 'Texture';
  }

  /** dimension of this texture */
  readonly dimension: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
  /** format of this texture */
  readonly format: TextureFormat;
  /** width in pixels of this texture */
  width: number;
  /** height in pixels of this texture */
  height: number;
  /** depth of this texture */
  readonly depth: number;
  /** Default sampler for this texture */
  abstract sampler: Sampler;

  /** Check if data is an external image */
  static isExternalImage(data: unknown): ExternalImage | null {
    return isExternalImage(data);
  }

  /** Check if texture data is a typed array */
  static isTextureLevelData(image: TextureData): TextureLevelData | null {
    const data = (image as TextureLevelData)?.data;
    return ArrayBuffer.isView(data) ? (image as TextureLevelData) : null;
  }

  /** Determine size (width and height) of provided image data */
  static getExternalImageSize(data: ExternalImage): {width: number; height: number} {
    return getExternalImageSize(data);
  }

  /** Get the size of the texture described by the provided TextureData */
  static getTextureDataSize(data: TextureData | TextureCubeData | TextureArrayData | TextureCubeArrayData): {width: number; height: number} {
    return getTextureDataSize(data);
  }

  constructor(device: Device, props: TextureProps) {
    super(device, props, Texture.defaultProps);
    this.dimension = this.props.dimension;
    this.format = this.props.format;
    this.width = this.props.width;
    this.height = this.props.height;
    this.depth = this.props.depth;
  }

  /** Set sampler props associated with this texture */
  abstract setSampler(sampler?: Sampler | SamplerProps): void;

  /**  */
  abstract setTexture1DData(data: Texture1DData): void;
  abstract setTexture2DData(lodData: Texture2DData, depth?: number, target?: number): void;
  abstract setTexture3DData(lodData: Texture3DData, depth?: number, target?: number): void;
  abstract setTextureCubeData(data: TextureCubeData, depth?: number): void;
  abstract setTextureArrayData(data: TextureArrayData): void;
  abstract setTextureCubeArrayData(data: TextureCubeArrayData): void;

/**
 * @param {*} pixels, data -
 *  null - create empty texture of specified format
 *  Typed array - init from image data in typed array
 *  Buffer|WebGLBuffer - (WEBGL2) init from image data in WebGLBuffer
 *  HTMLImageElement|Image - Inits with content of image. Auto width/height
 *  HTMLCanvasElement - Inits with contents of canvas. Auto width/height
 *  HTMLVideoElement - Creates video texture. Auto width/height
 *
 * @param  x - xOffset from where texture to be updated
 * @param  y - yOffset from where texture to be updated
 * @param  width - width of the sub image to be updated
 * @param  height - height of the sub image to be updated
 * @param  level - mip level to be updated
 * @param {GLenum} format - internal format of image data.
 * @param {GLenum} type
 *  - format of array (autodetect from type) or
 *  - (WEBGL2) format of buffer or ArrayBufferView
 * @param {GLenum} dataFormat - format of image data.
 * @param {Number} offset - (WEBGL2) offset from start of buffer
 * @parameters - temporary settings to be applied, can be used to supply pixel store settings.
 */
}

// HELPER METHODS

/** Check if data is an external image */
function isExternalImage(data: unknown): ExternalImage | null {
  const isExternalImage =
    (typeof ImageData !== 'undefined' && data instanceof ImageData) ||
    (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) ||
    (typeof HTMLImageElement !== 'undefined' && data instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && data instanceof HTMLCanvasElement) ||
    (typeof HTMLVideoElement !== 'undefined' && data instanceof HTMLVideoElement);
  return isExternalImage ? data as ExternalImage : null;
}

/** Determine size (width and height) of provided image data */
function getExternalImageSize(data: ExternalImage): {width: number; height: number} {
  if (typeof ImageData !== 'undefined' && data instanceof ImageData) {
    return {width: data.width, height: data.height};
  }
  if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) {
    return {width: data.width, height: data.height};
  }
  if (typeof HTMLImageElement !== 'undefined' && data instanceof HTMLImageElement) {
    return {width: data.naturalWidth, height: data.naturalHeight};
  }
  if (typeof HTMLCanvasElement !== 'undefined' && data instanceof HTMLCanvasElement) {
    return {width: data.width, height: data.height};
  }
  if (typeof HTMLVideoElement !== 'undefined' && data instanceof HTMLVideoElement) {
    return {width: data.videoWidth, height: data.videoHeight};
  }
  throw new Error('size');
}

/** Get the size of the texture described by the provided TextureData */
function getTextureDataSize(data: TextureData | TextureCubeData | TextureArrayData | TextureCubeArrayData): {width: number; height: number} {
  if (!data) {
    return {width: 1, height: 1};
  }
  if (Texture.isExternalImage(data)) {
    return Texture.getExternalImageSize(data as ExternalImage);
  }
  if (Array.isArray(data)) {
    return Texture.getTextureDataSize(data[0]);
  }
  if (data instanceof Promise) {
    throw new Error('size');
  }
  if (data && typeof data === 'object') {
    const untypedData = data as unknown as Record<string, number>; 
    return {width: untypedData.width, height: untypedData.height};
  }
  throw new Error('size');
}
