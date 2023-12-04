// luma.gl, MIT license
// Copyright (c) vis.gl contributors

// @todo texture refactor
// - [ ] cube texture init params P1
// - [ ] 3d texture init params P1
// - [ ] GPU memory tracking
// - [ ] raw data inputs
// - [ ] video (external) textures

import type {
  Device,
  TextureProps,
  Sampler,
  SamplerProps,
  SamplerParameters,
  TextureFormat,
  TextureCubeFace,
  ExternalImage,
  TextureLevelData,
  Texture1DData,
  Texture2DData,
  Texture3DData,
  TextureCubeData,
  TextureArrayData,
  TextureCubeArrayData
} from '@luma.gl/core';
// import {decodeTextureFormat} from '@luma.gl/core';
import {Buffer, Texture, cast, log, assert, isPowerOfTwo, loadImage} from '@luma.gl/core';
import {GL, GLSamplerParameters, GLTextureTarget, GLTextureCubeMapTarget} from '@luma.gl/constants';
// import {GLPixelDataType} from '@luma.gl/constants';
import {withGLParameters} from '../../context/state-tracker/with-parameters';
import {
  convertTextureFormatToGL
  // getWebGLTextureParameters,
  // getTextureFormatBytesPerPixel
} from '../converters/texture-formats';
import {
  convertSamplerParametersToWebGL
  // updateSamplerParametersForNPOT
} from '../converters/sampler-parameters';
import {WebGLDevice} from '../webgl-device';
import {WEBGLBuffer} from './webgl-buffer';
import {WEBGLSampler} from './webgl-sampler';

/**
 * NOTE - these constants are hard coded for now but we should extract them
 * const info = decodeTextureFormat(data.format);
 */
const getWebGLTextureFormatAndDataType = (format?: TextureFormat) => ({
  format: GL.RGBA,
  dataType: GL.UNSIGNED_BYTE
});

const BORDER = 0; // Required in many WebGL texture APIs, but must always be 0...

export type {TextureProps};

/**
 * WebGL... the texture API from hell... hopefully made simpler
 */
export class WEBGLTexture extends Texture {
  readonly MAX_ATTRIBUTES: number;
  readonly device: WebGLDevice;
  readonly gl: WebGLRenderingContext;
  readonly gl2: WebGL2RenderingContext | null;
  readonly handle: WebGLTexture;

  // inherited props
  // dimension: ...
  // format: GLTextureTarget;
  // width: number = undefined;
  // height: number = undefined;
  // depth: number = undefined;
  /** Sampler object (currently unused) */
  sampler: WEBGLSampler = undefined;

  // WebGL props

  /**
   * @note `target` cannot be modified by bind:
   * textures are special because when you first bind them to a target,
   * When you first bind a texture as a GL_TEXTURE_2D, you are saying that this texture is a 2D texture.
   * And it will always be a 2D texture; this state cannot be changed ever.
   * A texture that was first bound as a GL_TEXTURE_2D, must always be bound as a GL_TEXTURE_2D;
   * attempting to bind it as GL_TEXTURE_3D will give rise to a run-time error
   * */
  glTarget: GL;

  /** The WebGL constant corresponding to the WebGPU style constant in this.format */
  glFormat: GL;

  mipmaps: boolean = undefined;

  // TODO - this is assigned during bind, can be removed here
  // textureUnit: number = undefined;

  _video: {
    video: HTMLVideoElement;
    parameters: any;
    lastTime: number;
  };

  constructor(device: Device, props: TextureProps) {
    // Note: Clear out `props.data` so that we don't hold a reference to any big memory chunks
    super(device, {...Texture.defaultProps, ...props, data: undefined});

    this.device = cast<WebGLDevice>(device);
    this.gl = this.device.gl;
    this.gl2 = this.device.gl2;
    this.handle = this.props.handle || this.gl.createTexture();
    this.device.setSpectorMetadata(this.handle, {...this.props, data: typeof this.props.data});

    // Note: In WebGL the texture target defines the type of texture on first bind.
    this.glTarget = getWebGLTextureTarget(this.props.dimension);
    // The target format of this texture
    this.glFormat = convertTextureFormatToGL(this.props.format, this.device.isWebGL2);

    // Signature: new Texture2D(gl, {data: url})
    if (typeof this.props?.data === 'string') {
      Object.assign(this.props, {data: loadImage(this.props.data)});
    }

    // We removed data, we need to add it again.
    // @ts-expect-error
    this.initializeAsync({...this.props, data: props.data});
    Object.seal(this);
  }

  override destroy(): void {
    if (this.handle) {
      this.gl.deleteTexture(this.handle);
      this.removeStats();
      this.trackDeallocatedMemory('Texture');
      // this.handle = null;
      this.destroyed = true;
    }
  }

  override toString(): string {
    return `Texture(${this.id},${this.width}x${this.height})`;
  }

  /**
   * Resolve any promises in `data` and call "initialize()"
   * @param props
   * @returns
   */
  async initializeAsync(props: TextureProps = {}) {
    const data = await awaitAllPromises(props.data);

    return this.initialize({...props, data});
  }

  /**
   * Initialize texture with supplied props
   */
  // eslint-disable-next-line max-statements
  async initialize(props: TextureProps = {}): Promise<void> {
    const data = await props.data;

    const isVideo = typeof HTMLVideoElement !== 'undefined' && data instanceof HTMLVideoElement;
    // @ts-expect-error
    if (isVideo && data.readyState < HTMLVideoElement.HAVE_METADATA) {
      const video = data as HTMLVideoElement;
      this._video = null; // Declare member before the object is sealed
      video.addEventListener('loadeddata', () => this.initialize(props));
    }

    // const {parameters = {}  as Record<GL, any>} = props;

    let {width, height} = props;

    if (!width || !height) {
      const textureSize = Texture.getTextureDataSize(data);
      width = textureSize?.width || 1;
      height = textureSize?.height || 1;
    }

    // Store opts for accessors
    this.width = width;
    this.height = height;
    this.depth = props.depth;

    // prettier-ignore
    switch (this.props.dimension) {
      case '1d': this.setTexture1DData(data as Texture1DData); break;
      case '2d': this.setTexture2DData(data as Texture2DData); break;
      case '3d': this.setTexture3DData(props.data as TextureArrayData); break;
      case 'cube': this.setTextureCubeData(props.data as TextureCubeData); break;
      case '2d-array': this.setTextureArrayData(props.data as TextureArrayData); break;
      case 'cube-array': this.setTextureCubeArrayData(props.data as TextureCubeArrayData); break;
      default: throw new Error(props.dimension);
    }

    // Set texture sampler parameters
    this.setSampler(props.sampler);

    // TODO backards compatibility with GL parameters?
    // this._setSamplerParameters(parameters);

    this.mipmaps = props.mipmaps;
    if (props.mipmaps && this.device.isWebGL1 && isNPOT(this.width, this.height)) {
      log.warn(`texture: ${this} is Non-Power-Of-Two, disabling mipmaps`)();
      this.mipmaps = false;
    }

    if (this.mipmaps) {
      this.generateMipmap();
    }

    if (isVideo) {
      this._video = {
        video: data as HTMLVideoElement,
        // TODO  - should we be using the sampler parameters here?
        parameters: {},
        // @ts-expect-error HTMLVideoElement.HAVE_CURRENT_DATA is not declared
        lastTime: data.readyState >= HTMLVideoElement.HAVE_CURRENT_DATA ? data.currentTime : -1
      };
    }

    // This property is checked by draw(). The texture won't render until it is fully initialized
    this.loaded = true;
  }

  setSampler(sampler: Sampler | SamplerProps = {}): void {
    let samplerProps: SamplerParameters;
    if (sampler instanceof WEBGLSampler) {
      this.sampler = sampler;
      samplerProps = sampler.props;
    } else {
      this.sampler = new WEBGLSampler(this.device, sampler);
      samplerProps = sampler as SamplerProps;
    }

    // TODO - technically, this is only needed in WebGL1. In WebGL2 we could always use the sampler.
    const parameters = convertSamplerParametersToWebGL(samplerProps);
    this._setSamplerParameters(parameters);
  }

  /**
   * If size has changed, reinitializes with current format
   * @note note clears image and mipmaps
   */
  resize(options: {height: number; width: number; mipmaps?: boolean}): void {
    const {height, width, mipmaps = false} = options;
    if (width !== this.width || height !== this.height) {
      this.initialize({
        width,
        height,
        format: this.format,
        // type: this.type,
        // dataFormat: this.dataFormat,
        mipmaps
      });
    }
  }

  /** Update external texture (video frame or canvas) */
  update(): void {
    log.warn('Texture.update() not implemented');
    // if (this._video) {
    //   const {video, parameters, lastTime} = this._video;
    //   // @ts-expect-error
    //   if (lastTime === video.currentTime || video.readyState < HTMLVideoElement.HAVE_CURRENT_DATA) {
    //     return;
    //   }
    //   this.setSubImageData({
    //     data: video,
    //     parameters
    //   });
    //   if (this.mipmaps) {
    //     this.generateMipmap();
    //   }
    //   this._video.lastTime = video.currentTime;
    // }
  }

  // Call to regenerate mipmaps after modifying texture(s)
  generateMipmap(params = {}): void {
    if (this.device.isWebGL1 && isNPOT(this.width, this.height)) {
      log.warn(`texture: ${this} is Non-Power-Of-Two, disabling mipmaping`)();
      return;
    }

    this.mipmaps = true;

    this.gl.bindTexture(this.glTarget, this.handle);
    withGLParameters(this.gl, params, () => {
      this.gl.generateMipmap(this.glTarget);
    });
    this.gl.bindTexture(this.glTarget, null);
  }

  // Image Data Setters

  setTexture1DData(data: unknown): void {
    throw new Error('setTexture1DData not supported in WebGL.');
  }

  /** Set a simple texture */
  setTexture2DData(lodData: Texture2DData, depth = 0, glTarget = this.glTarget): void {
    this.bind();

    // If the user provides multiple LODs, then automatic mipmap
    // generation generateMipmap() should be disabled to avoid overwriting them.
    if (Array.isArray(lodData)) {
      if (lodData.length > 1 && this.props.mipmaps !== false) {
        log.warn(`Texture ${this.id} mipmap and multiple LODs.`)();
      }

      for (let lodLevel = 0; lodLevel < lodData.length; lodLevel++) {
        const imageData = lodData[lodLevel];
        this._setMipLevel(depth, lodLevel, imageData);
      }
    } else {
      const imageData = lodData;
      this._setMipLevel(depth, 0, imageData);
    }

    this.unbind();
  }

  /**
   * Sets a 3D texture
   * @param data
   */
  setTexture3DData(data: Texture3DData): void {
    if (this.props.dimension !== '3d') {
      throw new Error(this.id);
    }
    throw new Error('setTexture3DData not implemented.');
  }

  /**
   * Set a Texture Cube Data
   * @todo - could support TextureCubeArray with depth
   * @param data
   * @param index
   */
  setTextureCubeData(data: TextureCubeData, depth: number = 0): void {
    if (this.props.dimension !== 'cube') {
      throw new Error(this.id);
    }
    // for (const face of Texture.CubeFaces) {
    //   // this.setTextureCubeFaceData(face, data[face]);
    // }
  }

  /**
   * Sets an entire texture array
   * @param data
   */
  setTextureArrayData(data: TextureArrayData): void {
    if (this.props.dimension !== '2d-array') {
      throw new Error(this.id);
    }
    throw new Error('setTextureArrayData not implemented.');
  }

  /**
   * Sets an entire texture cube array
   * @param data
   */
  setTextureCubeArrayData(data: TextureCubeArrayData): void {
    throw new Error('setTextureCubeArrayData not supported in WebGL2.');
  }

  setTextureCubeFaceData(lodData: Texture2DData, face: TextureCubeFace, depth: number = 0): void {
    assert(this.props.dimension === 'cube');

    // If the user provides multiple LODs, then automatic mipmap
    // generation generateMipmap() should be disabled to avoid overwriting them.
    if (Array.isArray(lodData) && lodData.length > 1 && this.props.mipmaps !== false) {
      log.warn(`${this.id} has mipmap and multiple LODs.`)();
    }

    // const glFace = GL.TEXTURE_CUBE_MAP_POSITIVE_X + Texture.CubeFaces.indexOf(face);
    // const glType = GL.UNSIGNED_BYTE;
    // const {width, height, format = GL.RGBA, type = GL.UNSIGNED_BYTE} = this;
    // const {width, height, format = GL.RGBA, type = GL.UNSIGNED_BYTE} = this;

    this.bind();
    // for (let lodLevel = 0; lodLevel < lodData.length; lodLevel++) {
    //   const imageData = lodData[lodLevel];
    //   if (imageData instanceof ArrayBuffer) {
    //     // const imageData = image instanceof ArrayBuffer ? new ImageData(new Uint8ClampedArray(image), this.width) : image;
    //     this.device.gl2?.texImage2D?.(
    //       glFace,
    //       lodLevel,
    //       this.glFormat,
    //       this.glInternalFormat,
    //       glType,
    //       imageData
    //     );
    //   }
    // }
    this.unbind();
  }

    /*
  initializeCube(props?: TextureProps): void {
    const {mipmaps = true} = props; // , parameters = {} as Record<GL, any>} = props;

    // Store props for accessors
    // this.props = props;

    // @ts-expect-error
    this.setCubeMapData(props).then(() => {
      this.loaded = true;

      // TODO - should genMipmap() be called on the cubemap or on the faces?
      // TODO - without generateMipmap() cube textures do not work at all!!! Why?
      if (mipmaps) {
        this.generateMipmap(props);
      }

      this.setSampler(props.sampler);

      // v8 compatibility?
      // const {parameters = {} as Record<GL, any>} = props;
      // this._setSamplerParameters(parameters);
    });
  }
  */


  // HELPERS

  getActiveUnit(): number {
    return this.gl.getParameter(GL.ACTIVE_TEXTURE) - GL.TEXTURE0;
  }

  bind(textureUnit?: number): number {
    const {gl} = this;

    if (textureUnit !== undefined) {
      this.textureUnit = textureUnit;
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
    }

    gl.bindTexture(this.glTarget, this.handle);
    return textureUnit;
  }

  unbind(textureUnit?: number): number {
    const {gl} = this;

    if (textureUnit !== undefined) {
      this.textureUnit = textureUnit;
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
    }

    gl.bindTexture(this.glTarget, null);
    return textureUnit;
  }

  // INTERNAL METHODS

  /** @todo update this method to accept LODs */
  setImageDataForFace(options): void {
    const {
      face,
      width,
      height,
      pixels,
      data,
      format = GL.RGBA,
      type = GL.UNSIGNED_BYTE
      // generateMipmap = false // TODO
    } = options;

    const {gl} = this;

    const imageData = pixels || data;

    this.bind();
    if (imageData instanceof Promise) {
      imageData.then(resolvedImageData =>
        this.setImageDataForFace(
          Object.assign({}, options, {
            face,
            data: resolvedImageData,
            pixels: resolvedImageData
          })
        )
      );
    } else if (this.width || this.height) {
      gl.texImage2D(face, 0, format, width, height, 0 /* border*/, format, type, imageData);
    } else {
      gl.texImage2D(face, 0, format, format, type, imageData);
    }
  }

  _getImageDataMap(faceData: Record<string | GL, any>): Record<GL, any> {
    for (let i = 0; i < Texture.CubeFaces.length; ++i) {
      const faceName = Texture.CubeFaces[i];
      if (faceData[faceName]) {
        faceData[GL.TEXTURE_CUBE_MAP_POSITIVE_X + i] = faceData[faceName];
        delete faceData[faceName];
      }
    }
    return faceData;
  }

  // RESOURCE METHODS

  /**
   * Sets sampler parameters on texture
   * @note Applies NPOT overrides under WebGL if appropriate
   */
  _setSamplerParameters(parameters: GLSamplerParameters): void {
    // Work around WebGL1 sampling restrictions on non-power-of-two (NPOT) textures
    const npot = this.device.isWebGL1 && isNPOT(this.width, this.height);

    log.log(1, 'texture sampler parameters', parameters)();

    this.gl.bindTexture(this.glTarget, this.handle);
    for (const [pname, pvalue] of Object.entries(parameters)) {
      const param = Number(pname);
      let value = pvalue;

      // Apparently integer/float issues require two different texture parameter setting functions in JavaScript.
      // For now, pick the float version for parameters specified as GLfloat.
      switch (param) {
        case GL.TEXTURE_MIN_LOD:
        case GL.TEXTURE_MAX_LOD:
          this.gl.texParameterf(this.glTarget, param, value as number);
          break;

        case GL.TEXTURE_MIN_FILTER:
          if (npot && value !== GL.LINEAR && value !== GL.NEAREST) {
            // log.warn(`texture: ${this} is Non-Power-Of-Two, forcing TEXTURE_MIN_FILTER to LINEAR`)();
            value = GL.LINEAR;
          }
          this.gl.texParameteri(this.glTarget, param, value as number);
          break;

        case GL.TEXTURE_WRAP_S:
        case GL.TEXTURE_WRAP_T:
          if (npot && value !== GL.CLAMP_TO_EDGE) {
            // log.warn(`texture: ${this} is Non-Power-Of-Two, ${getKey(this.gl, pname)} to CLAMP_TO_EDGE`)(); }
            value = GL.CLAMP_TO_EDGE;
          }
          this.gl.texParameteri(this.glTarget, param, value as number);
          break;

        default:
          this.gl.texParameteri(this.glTarget, param, value as number);
          break;
      }
    }

    this.gl.bindTexture(this.glTarget, null);
  }

  // CLASSIC

  // TODO - remove?
  static FACES: number[] = [
    GL.TEXTURE_CUBE_MAP_POSITIVE_X,
    GL.TEXTURE_CUBE_MAP_NEGATIVE_X,
    GL.TEXTURE_CUBE_MAP_POSITIVE_Y,
    GL.TEXTURE_CUBE_MAP_NEGATIVE_Y,
    GL.TEXTURE_CUBE_MAP_POSITIVE_Z,
    GL.TEXTURE_CUBE_MAP_NEGATIVE_Z
  ];

  /* eslint-disable max-statements, max-len */
  async setCubeMapData(options: {
    width: number;
    height: number;
    data: Record<GL, Texture2DData> | Record<TextureCubeFace, Texture2DData>;
    format?: any;
    type?: any;
    /** @deprecated Use .data */
    pixels: any;
  }): Promise<void> {
    const {gl} = this;

    const {width, height, pixels, data, format = GL.RGBA, type = GL.UNSIGNED_BYTE} = options;

    // pixel data (imageDataMap) is an Object from Face to Image or Promise.
    // For example:
    // {
    // GL.TEXTURE_CUBE_MAP_POSITIVE_X : Image-or-Promise,
    // GL.TEXTURE_CUBE_MAP_NEGATIVE_X : Image-or-Promise,
    // ... }
    // To provide multiple level-of-details (LODs) this can be Face to Array
    // of Image or Promise, like this
    // {
    // GL.TEXTURE_CUBE_MAP_POSITIVE_X : [Image-or-Promise-LOD-0, Image-or-Promise-LOD-1],
    // GL.TEXTURE_CUBE_MAP_NEGATIVE_X : [Image-or-Promise-LOD-0, Image-or-Promise-LOD-1],
    // ... }

    const imageDataMap = this._getImageDataMap(pixels || data);

    const resolvedFaces = await Promise.all(
      WEBGLTexture.FACES.map(face => {
        const facePixels = imageDataMap[face];
        return Promise.all(Array.isArray(facePixels) ? facePixels : [facePixels]);
      })
    );

    this.bind();

    WEBGLTexture.FACES.forEach((face, index) => {
      if (resolvedFaces[index].length > 1 && this.props.mipmaps !== false) {
        // If the user provides multiple LODs, then automatic mipmap
        // generation generateMipmap() should be disabled to avoid overwritting them.
        log.warn(`${this.id} has mipmap and multiple LODs.`)();
      }
      resolvedFaces[index].forEach((image, lodLevel) => {
        // TODO: adjust width & height for LOD!
        if (width && height) {
          gl.texImage2D(face, lodLevel, format, width, height, 0 /* border*/, format, type, image);
        } else {
          gl.texImage2D(face, lodLevel, format, format, type, image);
        }
      });
    });

    this.unbind();
  }

  // INTERNAL SETTERS

  /**
   * Clear all the textures and mip levels of a two-dimensional or array texture at the same time.
   * On some implementations faster than repeatedly setting levels
   * @note The image contents are set as if a buffer of sufficient size initialized to 0 would be passed to each texImage2D/3D
   * @note WebGL2 only
   */
  _clearAllMipLevels(levels: number): void {
    this.device.assertWebGL2();
    switch (this.props.dimension) {
      case '2d-array':
      case '3d':
        // prettier-ignore
        this.gl2.texStorage3D(this.glTarget, levels, this.glFormat, this.width, this.height, this.depth);
        break;
      default:
        this.gl2.texStorage2D(this.glTarget, levels, this.glFormat, this.width, this.height);
    }
  }

  _setMipLevel(
    depth: number,
    level: number,
    image: Texture2DData,
    dataFormat = GL.UNSIGNED_BYTE,
    offset = 0
  ) {
    const imageSource = Texture.isExternalImage(image);
    const textureLevelData = Texture.isTextureLevelData(image);
    if (!image) {
      return;
    } else if (imageSource) {
      this._setMipLevelFromExternalImage(depth, level, imageSource, dataFormat, offset);
      return;
    } else if (textureLevelData) {
      const parameters = {};
      this._setMipLevelFromTypedArray(depth, level, textureLevelData, offset, parameters);
    } else {
      throw new Error(`Texture: invalid image data`);
    }
  }

  /**
   * @note Corresponds to WebGPU device.queue.copyExternalImageToTexture()
   */
  _setMipLevelFromExternalImage(
    depth: number,
    level: number,
    image: ExternalImage,
    dataFormat = GL.UNSIGNED_BYTE,
    offset = 0
  ) {
    // TODO - we can't change texture width (due to WebGPU limitations) -
    // and the width/heigh of an ezternal image is implicit, so why do we need to extract it?
    // So what width height do we supply? The image size or the texture size?
    // const {width, height} = Texture.getExternalImageSize(image);

    // NOTE - these constants are hard coded for now
    //   The WebGL docs do not really make it clear when an external image would have some other src format.
    //   How would we know? Or are we defining how data is to be read out from that image?
    const srcFormat = GL.RGBA;
    const srcType = GL.UNSIGNED_BYTE;

    switch (this.props.dimension) {
      case '2d-array':
      case '3d':
        // prettier-ignore
        this.gl2.texImage3D(this.glTarget, level, this.glFormat, this.width, this.height, depth, BORDER, srcFormat, srcType, image);
        break;

      default:
        if (this.device.isWebGL2) {
          // prettier-ignore
          this.device.gl2.texImage2D(this.glTarget,level,this.glFormat,this.width,this.height,BORDER,srcFormat,srcType,image);
        } else {
          // prettier-ignore
          this.device.gl.texImage2D(this.glTarget, level, this.glFormat, srcFormat, srcType, image);
        }
    }
  }

  /**
   * Set a texture level from a GPU buffer
   * @note Only available in WebGL2
   */
  _setMipLevelFromGPUBuffer(depth: number, level: number, buffer: Buffer, data: TextureLevelData) {
    // Creating textures directly from a WebGL buffer requires WebGL2
    this.device.assertWebGL2();

    const compressed = this.device.isTextureFormatCompressed(data.format);
    const glFormat = convertTextureFormatToGL(data.format, this.device.isWebGL2);

    const {format: glSrcFormat, dataType: glSrcType} = getWebGLTextureFormatAndDataType(
      data.format
    );
    const imageSize = data.data.byteLength;

    // In WebGL the buffer is not a parameter. Instead it needs to be bound to a special bind point
    const webglBuffer = buffer as WEBGLBuffer;
    this.device.gl2.bindBuffer(GL.PIXEL_UNPACK_BUFFER, webglBuffer.handle);

    switch (this.props.dimension) {
      case '2d-array':
      case '3d':
        if (compressed) {
          // srcFormat and srcType are fully specified by the compressed texture format
          // prettier-ignore
          this.device.gl2.compressedTexImage3D(this.glTarget, level, glFormat, data.width, data.height, depth, BORDER, imageSize, 0); // image size , offset
        } else {
          // prettier-ignore
          this.gl2.texImage3D(this.glTarget, level, glFormat, this.width, this.height, depth, BORDER, glSrcFormat, glSrcType, 0); // offset
        }
        break;

      default:
        if (compressed) {
          // srcFormat and srcType are fully specified by the compressed texture format
          // prettier-ignore
          this.device.gl.compressedTexImage2D(this.glTarget, level, glFormat, data.width, data.height, BORDER, data.data);
        } else {
          // prettier-ignore
          this.device.gl2.texImage2D(this.glTarget, level, this.glFormat, this.width, this.height, BORDER, glSrcFormat, glSrcType, 0); // offset
        }
    }

    this.device.gl2.bindBuffer(GL.PIXEL_UNPACK_BUFFER, null);
  }

  /**
   * Set a texture level from CPU memory
   * @note Not available (directly) in WebGPU
   *
   */
  _setMipLevelFromTypedArray(
    depth: number,
    level: number,
    data: TextureLevelData,
    offset = 0,
    parameters
  ): void {
    const compressed = this.device.isTextureFormatCompressed(data.format);
    const glFormat = convertTextureFormatToGL(data.format, this.device.isWebGL2);

    const {format: glSrcFormat, dataType: glSrcType} = getWebGLTextureFormatAndDataType(
      data.format
    );

    withGLParameters(this.gl, parameters, () => {
      switch (this.props.dimension) {
        case '2d-array':
        case '3d':
          if (compressed) {
            // srcFormat and srcType are fully specified by the compressed texture format
            // prettier-ignore
            this.device.gl2.compressedTexImage3D(this.glTarget,level,glFormat,data.width,data.height,depth,BORDER, data.data);
          } else {
            // prettier-ignore
            this.gl2.texImage3D( this.glTarget, level, this.glFormat, this.width, this.height, depth, BORDER, glSrcFormat, glSrcType, data.data);
          }
          break;

        default:
          // Looks like this assert is not necessary, as offset is ignored under WebGL1
          // assert((offset === 0 || this.device.isWebGL2), 'offset supported in WebGL2 only');
          if (compressed) {
            // prettier-ignore
            this.device.gl.compressedTexImage2D(this.glTarget,level,glFormat,data.width,data.height,BORDER,data.data);
          } else {
            // prettier-ignore
            this.device.gl2.texImage2D( this.glTarget, level, this.glFormat, this.width, this.height, BORDER, glSrcFormat, glSrcType, data.data, offset);
          }
      }
    });
  }

  /**
   * Copy a region of compressed data from a GPU memory buffer into this texture.
   */
  _copyExternalImageToMipLevel(options: {
    image: ExternalImage;
    depth?: number;
    mipLevel?: number;
    // TODO clearly separate between array offsets and source offsets
    x?: number;
    y?: number;
    z?: number;
    width?: number;
    height?: number;
  }): void {
    const size = Texture.getExternalImageSize(options.image);
    const {
      image,
      depth = 0,
      mipLevel = 0,
      x = 0,
      y = 0,
      z = 0,
      width = size.width,
      height = size.height
    } = options;

    // NOTE - these constants are hard coded for now until we understand how to use them
    const srcFormat = GL.RGBA;
    const srcType = GL.UNSIGNED_BYTE;

    switch (this.props.dimension) {
      case '2d-array':
      case '3d':
        // prettier-ignore
        this.device.gl2.texSubImage3D(this.glTarget, mipLevel, x, y, z, width, height, depth, srcFormat, srcType, image);
        break;
      default:
        if (this.device.isWebGL2) {
          // prettier-ignore
          this.device.gl2.texSubImage2D( this.glTarget, mipLevel, x, y, width, height, srcFormat, srcType, image);
        } else {
          // prettier-ignore
          this.device.gl.texSubImage2D(this.glTarget, mipLevel, x, y, srcFormat, srcType, image);
        }
    }
  }

  /**
   * Copy a region of data from a CPU memory buffer into this texture.
   */
  _copyCPUDataToMipLevel(depth: number, level: number, data: TextureLevelData, x, y, z): void {
    const compressed = this.device.isTextureFormatCompressed(data.format);
    const glFormat = convertTextureFormatToGL(data.format, this.device.isWebGL2);

    const typedArray = data.data;
    const srcFormat = GL.RGBA;
    const srcType = GL.UNSIGNED_BYTE;

    switch (this.props.dimension) {
      case '2d-array':
      case '3d':
        if (compressed) {
          // TODO enable extension?
          // prettier-ignore
          this.device.gl2.compressedTexSubImage3D(this.glTarget, level, x, y, z, data.width, data.height, depth, srcFormat, typedArray); // Format of the compressed data typedArray
        } else {
          // prettier-ignore
          this.device.gl2.texSubImage3D(this.glTarget, level, x, y, z, data.width, data.height, srcFormat, srcType, srcFormat, 0);
        }
        break;

      default:
        if (compressed) {
          // target, level, x, y, width, height, glFormat, data);
          // prettier-ignore
          this.device.gl.compressedTexSubImage2D(this.glTarget, level, x, y, data.width, data.height, glFormat, data.data);
        } else {
          // target, level, x, y, width, height, glFormat, data);
          // prettier-ignore
          this.device.gl.texSubImage2D(this.glTarget, level, x, y, data.width, data.height, glFormat, BORDER, data.data);
        }
    }
  }

  /**
   * Copy a region of compressed data from a GPU memory buffer into this texture.
   * @todo - input data should be a GPUBuffer
   */
  _setMipLevelFromGPUBuffer2(depth: number, level: number, data: TextureLevelData, x, y, z): void {
    const compressed = this.device.isTextureFormatCompressed(data.format);
    const glFormat = convertTextureFormatToGL(data.format, this.device.isWebGL2);

    // NOTE - these constants are hard coded for now until we understand how to use them
    const srcData = data.data;
    const srcFormat = GL.RGBA;
    const srcType = GL.UNSIGNED_BYTE;

    switch (this.props.dimension) {
      case '2d-array':
      case '3d':
        // 3 dimensional textures requires 3D texture functions
        if (compressed) {
          // TODO enable extension?
          // prettier-ignore
          this.device.gl2.compressedTexSubImage3D(this.glTarget, level, x, y, z, data.width, data.height, depth, srcFormat, 0, 0);
        } else {
          // prettier-ignore
          this.device.gl2.texSubImage3D(this.glTarget, level, x, y, z, data.width, data.height, depth, glFormat, srcType, data.data, 0);
        }
        break;

      default:
        if (compressed) {
          // target, level, x, y, width, height, glFormat, data);
          // prettier-ignore
          this.device.gl.compressedTexSubImage2D(this.glTarget, level, x, y, data.width, data.height, srcFormat, srcData);
        } else {
          // target, level, x, y, width, height, glFormat, data);
          // prettier-ignore
          this.device.gl.texSubImage2D(this.glTarget, level, x, y, data.width, data.height, BORDER, srcFormat, srcData);
        }
    }
  }
}

// HELPERS

/** Resolve all promises in a nested data structure */
async function awaitAllPromises(x: any) {
  x = await x;
  if (Array.isArray(x)) {
    return x.map(awaitAllPromises);
  }
  if (x && typeof x === 'object' && x.constructor === Object) {
    const entries = Object.entries(x).map(([key, value]) => [key, awaitAllPromises(value)]);
    return Object.fromEntries(entries);
  }
  return x;
}

/** Convert a WebGPU style texture constant to a WebGL style texture constant */
// prettier-ignore
function getWebGLTextureTarget(dimension: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d'): GLTextureTarget {
  switch (dimension) {
    case '1d':
      break; // not supported in any WebGL version
    case '2d':
      return GL.TEXTURE_2D; // supported in WebGL1
    case '3d':
      return GL.TEXTURE_3D; // supported in WebGL2
    case 'cube':
      return GL.TEXTURE_CUBE_MAP; // supported in WebGL1
    case '2d-array':
      return GL.TEXTURE_2D_ARRAY; // supported in WebGL2
    case 'cube-array':
      break; // not supported in any WebGL version
  }
  throw new Error(dimension);
}

export function getWebGLCubeFaceTarget(face: TextureCubeFace): GLTextureCubeMapTarget {
  // prettier-ignore
  switch (face) {
    case '+X': return  GL.TEXTURE_CUBE_MAP_POSITIVE_X;
    case '-X': return  GL.TEXTURE_CUBE_MAP_NEGATIVE_X;
    case '+Y': return  GL.TEXTURE_CUBE_MAP_POSITIVE_Y;
    case '-Y': return  GL.TEXTURE_CUBE_MAP_NEGATIVE_Y;
    case '+Z': return  GL.TEXTURE_CUBE_MAP_POSITIVE_Z;
    case '-Z': return  GL.TEXTURE_CUBE_MAP_NEGATIVE_Z;
    default:
      throw new Error(face);
    }
}

/** Return true if the texture width and height are powers of two */
function isNPOT(width: number, height: number): boolean {
  // Width and height not available, avoid classifying as NPOT texture
  if (!width || !height) {
    return false;
  }
  return !isPowerOfTwo(width) || !isPowerOfTwo(height);
}
