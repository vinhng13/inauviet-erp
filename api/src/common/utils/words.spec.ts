import { vndInWords } from './words';

describe('vndInWords', () => {
  it('reads amounts the Vietnamese way', () => {
    expect(vndInWords(0)).toBe('Không đồng');
    expect(vndInWords(1_440_000)).toBe('Một triệu bốn trăm bốn mươi nghìn đồng');
    expect(vndInWords(12_000_000)).toBe('Mười hai triệu đồng');
    expect(vndInWords(1_005_000)).toBe('Một triệu không trăm lẻ năm nghìn đồng');
    expect(vndInWords(215_000)).toBe('Hai trăm mười lăm nghìn đồng');
    expect(vndInWords(21_000)).toBe('Hai mươi mốt nghìn đồng');
    expect(vndInWords(2_000_000_000)).toBe('Hai tỷ đồng');
  });
});
