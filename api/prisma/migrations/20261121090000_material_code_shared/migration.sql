-- Mã vật tư = Mã VT trong bảng theo dõi (DC, GN, Op, C150…): nhiều vật tư dùng chung một mã, nên bỏ ràng buộc duy nhất
DROP INDEX IF EXISTS "WhMaterial_code_key";
CREATE INDEX "WhMaterial_code_idx" ON "WhMaterial"("code");
