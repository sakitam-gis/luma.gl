import {CommandEncoder, CommandEncoderProps, Buffer, Texture} from '@luma.gl/core';
import type {CopyTextureToTextureOptions, CopyTextureToBufferOptions} from '@luma.gl/core';
import {WebGPUDevice} from '../webgpu-device';
import {WebGPUBuffer} from './webgpu-buffer';
import {WebGPUTexture} from './webgpu-texture';

export class WebGPUCommandEncoder extends CommandEncoder {
  readonly device: WebGPUDevice;
  readonly handle: GPUCommandEncoder;

  constructor(device: WebGPUDevice, props: CommandEncoderProps) {
    super(device, props);
    this.device = device;
    this.handle =
      props.handle ||
      this.device.handle.createCommandEncoder({
        // TODO was this removed in standard?
        // measureExecutionTime: this.props.measureExecutionTime
      });
    this.handle.label = this.props.id;
  }

  override destroy(): void {}

  finish(options?: {id?: string}): GPUCommandBuffer {
    return this.finish(options);
  }

  // beginRenderPass(GPURenderPassDescriptor descriptor): GPURenderPassEncoder;
  // beginComputePass(optional GPUComputePassDescriptor descriptor = {}): GPUComputePassEncoder;

  copyBufferToBuffer(options: // CopyBufferToBufferOptions
  {
    source: Buffer;
    sourceOffset?: number;
    destination: Buffer;
    destinationOffset?: number;
    size?: number;
  }): void {
    const webgpuSourceBuffer = options.source as WebGPUBuffer;
    const WebGPUDestinationBuffer = options.destination as WebGPUBuffer;
    this.handle.copyBufferToBuffer(
      webgpuSourceBuffer.handle,
      options.sourceOffset ?? 0,
      WebGPUDestinationBuffer.handle,
      options.destinationOffset ?? 0,
      options.size ?? 0
    );
  }

  copyBufferToTexture(options: // CopyBufferToTextureOptions
  {
    source: Buffer;
    offset?: number;
    bytesPerRow: number;
    rowsPerImage: number;

    destination: Texture;
    mipLevel?: number;
    aspect?: 'all' | 'stencil-only' | 'depth-only';

    origin?: number[] | [number, number, number];
    extent?: number[] | [number, number, number];
  }): void {
    const webgpuSourceBuffer = options.source as WebGPUBuffer;
    const WebGPUDestinationTexture = options.destination as WebGPUTexture;
    this.handle.copyBufferToTexture(
      {
        buffer: webgpuSourceBuffer.handle,
        offset: options.offset ?? 0,
        bytesPerRow: options.bytesPerRow,
        rowsPerImage: options.rowsPerImage
      },
      {
        texture: WebGPUDestinationTexture.handle,
        mipLevel: options.mipLevel ?? 0,
        origin: options.origin ?? {}
        // aspect: options.aspect
      },
      {
        // TODO exclamation mark hack
        width: options.extent[0],
        height: options.extent[1],
        depthOrArrayLayers: options.extent[2]
      }
    );
  }

  copyTextureToBuffer(options: CopyTextureToBufferOptions): void {
    // this.handle.copyTextureToBuffer(
    //   // source
    //   {},
    //   // destination
    //   {},
    //   // copySize
    //   {}
    // );
  }

  copyTextureToTexture(options: CopyTextureToTextureOptions): void {
    // this.handle.copyTextureToTexture(
    //   // source
    //   {},
    //   // destination
    //   {},
    //   // copySize
    //   {}
    // );
  }

  override pushDebugGroup(groupLabel: string): void {
    this.handle.pushDebugGroup(groupLabel);
  }

  override popDebugGroup(): void {
    this.handle.popDebugGroup();
  }

  override insertDebugMarker(markerLabel: string): void {
    this.handle.insertDebugMarker(markerLabel);
  }

  // writeTimestamp(querySet: Query, queryIndex: number): void {}

  // resolveQuerySet(options: {
  //   querySet: GPUQuerySet,
  //   firstQuery: number,
  //   queryCount: number,
  //   destination: Buffer,
  //   destinationOffset?: number;
  // }): void;
}
