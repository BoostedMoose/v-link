import { describe, expect, it } from 'vitest'
import { getDecoderConfig, isKeyFrame } from './utils'

describe('H.264 frame inspection', () => {
  it('treats malformed SPS data as a dropped frame instead of throwing', () => {
    const malformedSps = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, // Annex-B start code
      0x67, // SPS NAL unit
      0xff, 0xff, 0xff, 0xff,
    ])

    expect(() => getDecoderConfig(malformedSps)).not.toThrow()
    expect(getDecoderConfig(malformedSps)).toBeNull()
    expect(() => isKeyFrame(malformedSps)).not.toThrow()
  })
})
