// luma.gl, MIT license
// Copyright (c) vis.gl contributors

import test from 'tape-promise/tape';
import {webgl1Device, webgl2Device} from '@luma.gl/test-utils';

import {GL} from '@luma.gl/constants';
import {setDeviceParameters, GLParameters, getGLParameters, resetGLParameters} from '@luma.gl/webgl';

// Settings test, could be beneficial to not reuse a context
const fixture = {
  gl: webgl1Device.gl,
  gl2: webgl2Device?.gl2
};

const {gl} = fixture;

// const stringify = (v) => JSON.stringify(ArrayBuffer.isView(v) ? Array.apply([], v) : v);

const getGLParameter = (parameter: keyof GLParameters): any => {
  const parameters = getGLParameters(gl, [parameter]);
  return parameters[parameter];
}

test('setDeviceParameters#cullMode', (t) => {
  resetGLParameters(gl);

  t.deepEqual(getGLParameter(GL.CULL_FACE), false, 'got expected value');

  setDeviceParameters(webgl1Device, {cullMode: 'front'});
  t.deepEqual(getGLParameter(GL.CULL_FACE), true, 'got expected value');
  t.deepEqual(getGLParameter(GL.CULL_FACE_MODE), GL.FRONT, 'got expected value');

  setDeviceParameters(webgl1Device, {cullMode: 'back'});
  t.deepEqual(getGLParameter(GL.CULL_FACE), true, 'got expected value');
  t.deepEqual(getGLParameter(GL.CULL_FACE_MODE), GL.BACK, 'got expected value');

  setDeviceParameters(webgl1Device, {cullMode: 'none'});
  t.deepEqual(getGLParameter(GL.CULL_FACE), false, 'got expected value');

  t.end();
});

test('setDeviceParameters#frontFace', (t) => {
  resetGLParameters(gl);

  t.deepEqual(getGLParameter(GL.FRONT_FACE), GL.CCW, 'got expected value');

  setDeviceParameters(webgl1Device, {frontFace: 'cw'});
  t.deepEqual(getGLParameter(GL.FRONT_FACE), GL.CW, 'got expected value');

  setDeviceParameters(webgl1Device, {frontFace: 'ccw'});
  t.deepEqual(getGLParameter(GL.FRONT_FACE), GL.CCW, 'got expected value');

  t.end();
});

test('setDeviceParameters#depthWriteEnabled', (t) => {
  resetGLParameters(gl);

  t.deepEqual(getGLParameter(GL.DEPTH_WRITEMASK), true, 'got expected value');

  setDeviceParameters(webgl1Device, {depthWriteEnabled: false});
  t.deepEqual(getGLParameter(GL.DEPTH_WRITEMASK), false, 'got expected value');

  setDeviceParameters(webgl1Device, {depthWriteEnabled: true});
  t.deepEqual(getGLParameter(GL.DEPTH_WRITEMASK), true, 'got expected value');

  t.end();
});

test('setDeviceParameters#blending', (t) => {
  resetGLParameters(gl);

  t.equal(getGLParameter(GL.BLEND), false, 'blending disabled');

  setDeviceParameters(webgl1Device, {blendColorOperation: 'add', blendAlphaOperation: 'subtract'});

  t.equal(getGLParameter(GL.BLEND), true, 'GL.BLEND = true');
  t.equal(getGLParameter(GL.BLEND_EQUATION_RGB), GL.FUNC_ADD, 'GL.BLEND_EQUATION_RGB = GL.FUNC_ADD');
  t.equal(getGLParameter(GL.BLEND_EQUATION_ALPHA), GL.FUNC_SUBTRACT, 'GL.BLEND_EQUATION_ALPHA = GL.FUNC_SUBTRACT');
  t.equal(getGLParameter(GL.BLEND_SRC_RGB), GL.ONE, 'GL.BLEND_SRC_RGB = GL.ONE');
  t.equal(getGLParameter(GL.BLEND_DST_RGB), GL.ZERO, 'GL.BLEND_DST_RGB = GL.ZERO');
  t.equal(getGLParameter(GL.BLEND_SRC_ALPHA), GL.ONE, 'GL.BLEND_SRC_ALPHA = GL.ONE');
  t.equal(getGLParameter(GL.BLEND_DST_ALPHA), GL.ZERO, 'GL.BLEND_DST_ALPHA = GL.ZERO');

  setDeviceParameters(webgl1Device, {
    blendColorOperation: 'max',
    blendAlphaOperation: 'min',
    blendColorSrcFactor: 'src-alpha',
    blendColorDstFactor: 'dst-alpha',
    blendAlphaSrcFactor: 'zero',
    blendAlphaDstFactor: 'one',
  });

  t.equal(getGLParameter(GL.BLEND), true, 'GL.BLEND = true');
  t.equal(getGLParameter(GL.BLEND_EQUATION_RGB), GL.MAX, 'GL.BLEND_EQUATION_RGB = GL.MAX');
  t.equal(getGLParameter(GL.BLEND_EQUATION_ALPHA), GL.MIN, 'GL.BLEND_EQUATION_ALPHA = GL.MIN');
  t.equal(getGLParameter(GL.BLEND_SRC_RGB), GL.SRC_ALPHA, 'GL.BLEND_SRC_RGB = GL.SRC_ALPHA');
  t.equal(getGLParameter(GL.BLEND_DST_RGB), GL.DST_ALPHA, 'GL.BLEND_DST_RGB = GL.DST_ALPHA');
  t.equal(getGLParameter(GL.BLEND_SRC_ALPHA), GL.ZERO, 'GL.BLEND_SRC_ALPHA = GL.ZERO');
  t.equal(getGLParameter(GL.BLEND_DST_ALPHA), GL.ONE, 'GL.BLEND_DST_ALPHA = GL.ONE');

  t.end();
});

test('setDeviceParameters#depthCompare', (t) => {
  resetGLParameters(gl);

  t.equal(getGLParameter(GL.DEPTH_TEST), false, 'GL.DEPTH_TEST = false');

  setDeviceParameters(webgl1Device, {depthCompare: 'less'});
  t.equal(getGLParameter(GL.DEPTH_TEST), true, 'GL.DEPTH_TEST = true');
  t.equal(getGLParameter(GL.DEPTH_FUNC), GL.LESS, 'GL.DEPTH_FUNC = GL.LESS');

  setDeviceParameters(webgl1Device, {depthCompare: 'always'});
  t.equal(getGLParameter(GL.DEPTH_TEST), false, 'GL.DEPTH_TEST = false');
  t.equal(getGLParameter(GL.DEPTH_FUNC), GL.ALWAYS, 'GL.DEPTH_FUNC = GL.ALWAYS');

  t.end();
});

test.skip('setDeviceParameters#depthClearValue', (t) => {
  // let value = getGLParameters(gl, [GL.DEPTH_CLEAR_VALUE])[GL.DEPTH_CLEAR_VALUE];
  // t.is(value, 1, `got expected value ${stringify(value)}`);

  // // setDeviceParameters(gl, {[GL.DEPTH_CLEAR_VALUE]: -1});
  // value = getGLParameters(gl, [GL.DEPTH_CLEAR_VALUE])[GL.DEPTH_CLEAR_VALUE];
  // t.is(value, -1, `got expected value ${stringify(value)}`);

  // // @ts-expect-error
  // t.throws(() => setDeviceParameters({}), 'throws with non WebGL context');

  t.end();
});
