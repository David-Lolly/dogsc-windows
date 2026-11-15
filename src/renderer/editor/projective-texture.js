'use strict';
// Shared GPU texture projection used by preview and export.
class ProjectiveTextureRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    const shader = (type, text) => {
      const value = gl.createShader(type); gl.shaderSource(value, text); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
      return value;
    };
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
      in vec3 point; in vec2 uv; out vec2 textureUV;
      void main() { gl_Position=vec4(point.xy*point.z,0.0,point.z); textureUV=uv; }`);
    const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec2 textureUV; uniform sampler2D image; out vec4 color;
      void main() { color=texture(image,textureUV); }`);
    const program = this.program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    this.buffer = gl.createBuffer(); this.texture = gl.createTexture();
  }

  draw(frame, quad) {
    const gl = this.gl, { width, height } = this.canvas;
    gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const coordinates = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const values = [0, 1, 2, 0, 2, 3].flatMap((i) => [quad[i].x / width * 2 - 1, 1 - quad[i].y / height * 2, quad[i].w, ...coordinates[i]]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
    for (const [name, size, offset] of [['point', 3, 0], ['uv', 2, 12]]) {
      const attribute = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 20, offset);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL projective draw failed');
  }

  dispose() {
    this.gl.deleteTexture(this.texture); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program);
  }
}
module.exports = { ProjectiveTextureRenderer };
