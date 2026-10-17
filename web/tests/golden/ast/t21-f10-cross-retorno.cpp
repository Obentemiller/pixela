struct Vec3 { double x, y, z; };
Vec3 cross(const Vec3 &o) const { return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x}; }
