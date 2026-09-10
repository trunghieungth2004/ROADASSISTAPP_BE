FROM ghcr.io/project-osrm/osrm-backend:latest

ARG OSM_URL=https://download.geofabrik.de/asia/vietnam-latest.osm.pbf

WORKDIR /data
ADD ${OSM_URL} /data/region.osm.pbf
COPY motorbike.lua /tmp/motorbike.lua

RUN set -eux; \
  PROFILE_DIR="$(dirname "$(find / -name car.lua -path '*profiles*' 2>/dev/null | head -1)")"; \
  cp /tmp/motorbike.lua "$PROFILE_DIR/motorbike.lua"; \
  osrm-extract -p "$PROFILE_DIR/motorbike.lua" /data/region.osm.pbf --output /data/motorbike; \
  osrm-partition /data/motorbike.osrm; \
  osrm-customize /data/motorbike.osrm; \
  rm /data/region.osm.pbf /tmp/motorbike.lua

EXPOSE 5000
CMD ["osrm-routed", "--algorithm", "mld", "--port", "5000", "/data/motorbike.osrm"]
