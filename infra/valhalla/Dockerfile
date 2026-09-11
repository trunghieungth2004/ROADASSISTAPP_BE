FROM ghcr.io/valhalla/valhalla:latest

ARG OSM_URL=https://download.geofabrik.de/asia/vietnam-latest.osm.pbf

WORKDIR /data
ADD ${OSM_URL} /data/region.osm.pbf

RUN set -eux; \
  valhalla_build_config \
    --mjolnir-tile-dir /data/tiles \
    --mjolnir-tile-extract /data/tiles.tar \
    --mjolnir-timezone /data/timezones.sqlite \
    --mjolnir-admin /data/admins.sqlite \
    > /data/valhalla.json; \
  sed -i 's/"max_exclude_polygons_length": [0-9][0-9]*/"max_exclude_polygons_length": 100000/' /data/valhalla.json; \
  grep -q '"max_exclude_polygons_length": 100000' /data/valhalla.json; \
  valhalla_build_tiles -c /data/valhalla.json /data/region.osm.pbf; \
  valhalla_build_admins -c /data/valhalla.json /data/region.osm.pbf; \
  valhalla_build_extract -c /data/valhalla.json; \
  test -s /data/tiles.tar; \
  rm -rf /data/tiles /data/region.osm.pbf

EXPOSE 8002
CMD ["valhalla_service", "/data/valhalla.json", "2"]
