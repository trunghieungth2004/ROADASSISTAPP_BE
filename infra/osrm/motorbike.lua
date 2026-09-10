
api_version = 4

Set = require('lib/set')
Sequence = require('lib/sequence')
Handlers = require("lib/way_handlers")
Relations = require("lib/relations")
Obstacles = require("lib/obstacles")
find_access_tag = require("lib/access").find_access_tag
resolve_access = require("lib/access").resolve_access
limit = require("lib/maxspeed").limit
Utils = require("lib/utils")
Measure = require("lib/measure")

local car = require('car')

local NARROW_MAX = 0.8
local MEDIUM_MAX = 1.0

local function width_classes(profile, way, result, data)
  if result.forward_classes == nil or result.backward_classes == nil then
    return
  end
  local width = way:get_value_by_key('width') or way:get_value_by_key('maxwidth')
  if width == nil or width == '' then
    return
  end
  local meters = tonumber((width:gsub(',', '.'):match('^%s*([%d%.]+)')))
  if meters == nil then
    return
  end
  if meters < NARROW_MAX then
    result.forward_classes['narrowonly'] = true
    result.backward_classes['narrowonly'] = true
  elseif meters <= MEDIUM_MAX then
    result.forward_classes['mediumonly'] = true
    result.backward_classes['mediumonly'] = true
  end
end

function setup()
  local profile = car.setup()

  profile.access_tags_hierarchy = Sequence {
    'motorcycle',
    'motor_vehicle',
    'vehicle',
    'access'
  }

  profile.restrictions = Sequence {
    'motorcycle',
    'motor_vehicle',
    'vehicle'
  }

  profile.access_tag_whitelist = Set {
    'yes',
    'motorcycle',
    'motor_vehicle',
    'vehicle',
    'permissive',
    'designated',
    'moped',
    'mofa',
    'hov'
  }

  profile.default_speed = 8
  profile.turn_penalty = 5
  profile.u_turn_penalty = 10

  profile.speeds = Sequence {
    highway = {
      motorway        = 70,
      motorway_link   = 30,
      trunk           = 60,
      trunk_link      = 25,
      primary         = 50,
      primary_link    = 25,
      secondary       = 40,
      secondary_link  = 20,
      tertiary        = 30,
      tertiary_link   = 15,
      unclassified    = 20,
      residential     = 20,
      living_street   = 10,
      service         = 15,
      winter_road     = 20,
      ice_road        = 15
    }
  }

  profile.vehicle_height = 1.6
  profile.vehicle_width = 0.8
  profile.vehicle_length = 2.2
  profile.vehicle_weight = 400

  profile.classes = Sequence {
    'toll', 'motorway', 'ferry', 'restricted', 'tunnel',
    'narrowonly', 'mediumonly'
  }

  profile.excludable = Sequence {
    Set {'narrowonly'},
    Set {'narrowonly', 'mediumonly'}
  }

  return profile
end

function process_node(profile, node, result, relations)
  local access = resolve_access(find_access_tag(node, profile.access_tags_hierarchy), profile)
  if access then
    if profile.access_tag_blacklist[access] and not profile.restricted_access_tag_list[access] then
      obstacle_map:add(node, Obstacle.new(obstacle_type.barrier))
    end
  else
    local barrier = node:get_value_by_key("barrier")
    if barrier then
      local restricted_by_height = false
      if barrier == 'height_restrictor' then
         local maxheight = Measure.get_max_height(node:get_value_by_key("maxheight"), node)
         restricted_by_height = maxheight and maxheight < profile.vehicle_height
      end

      local bollard = node:get_value_by_key("bollard")
      local rising_bollard = bollard and "rising" == bollard

      local kerb = node:get_value_by_key("kerb")
      local highway = node:get_value_by_key("highway")
      local flat_kerb = kerb and ("lowered" == kerb or "flush" == kerb)
      local highway_crossing_kerb = barrier == "kerb" and highway and highway == "crossing"

      local sensory = node:get_value_by_key("sensory")
      local audible_fence = barrier == "fence" and sensory and (sensory == "audible" or sensory == "audio")

      local barrier_penalty = profile.barrier_penalties[barrier]

      if not profile.barrier_whitelist[barrier]
                and not rising_bollard
                and not flat_kerb
                and not highway_crossing_kerb
                and not audible_fence
                and not barrier_penalty
                or restricted_by_height then
        obstacle_map:add(node, Obstacle.new(obstacle_type.barrier))
      end

      if barrier_penalty then
        obstacle_map:add(node, Obstacle.new(obstacle_type.gate,
                                            obstacle_direction.both, barrier_penalty, 0))
      end
    end
  end

  Obstacles.process_node(profile, node)
end

function process_way(profile, way, result, relations)


  local data = {
    highway = way:get_value_by_key('highway'),
    bridge = way:get_value_by_key('bridge'),
    route = way:get_value_by_key('route')
  }

  if (not data.highway or data.highway == '') and
  (not data.route or data.route == '')
  then
    return
  end

  handlers = Sequence {
    WayHandlers.default_mode,

    WayHandlers.blocked_ways,
    WayHandlers.avoid_ways,
    WayHandlers.handle_height,
    WayHandlers.handle_width,
    WayHandlers.handle_length,
    WayHandlers.handle_weight,

    WayHandlers.access,

    WayHandlers.oneway,

    WayHandlers.destinations,

    WayHandlers.ferries,
    WayHandlers.movables,

    WayHandlers.service,

    WayHandlers.hov,

    WayHandlers.speed,
    WayHandlers.maxspeed,
    WayHandlers.surface,

    WayHandlers.vehicle_speed_cap,

    WayHandlers.penalties,

    WayHandlers.classes,

    width_classes,

    WayHandlers.turn_lanes,
    WayHandlers.classification,

    WayHandlers.startpoint,

    WayHandlers.roundabouts,

    WayHandlers.names,

    WayHandlers.weights,

    WayHandlers.way_classification_for_turn
  }

  WayHandlers.run(profile, way, result, data, handlers, relations)

  if profile.cardinal_directions then
      Relations.process_way_refs(way, relations, result)
  end
end

function process_turn(profile, turn)
  local turn_penalty = profile.turn_penalty
  local turn_bias = turn.is_left_hand_driving and 1. / profile.turn_bias or profile.turn_bias

  for _, obs in pairs(obstacle_map:get(turn.from, turn.via)) do
    if obs.type == obstacle_type.stop_minor and not Obstacles.entering_by_minor_road(turn) then
        goto skip
    end
    if turn.number_of_roads == 2
        and obs.type == obstacle_type.stop
        and obs.direction == obstacle_direction.none
        and turn.source_road.distance < 20
        and turn.target_road.distance > 20 then
            goto skip
    end
    turn.duration = turn.duration + obs.duration
    ::skip::
  end

  if turn.number_of_roads > 2 or turn.source_mode ~= turn.target_mode or turn.is_u_turn then
    if turn.angle >= 0 then
      turn.duration = turn.duration + turn_penalty / (1 + math.exp( -((13 / turn_bias) *  turn.angle/180 - 6.5*turn_bias)))
    else
      turn.duration = turn.duration + turn_penalty / (1 + math.exp( -((13 * turn_bias) * -turn.angle/180 - 6.5/turn_bias)))
    end

    if turn.is_u_turn then
      turn.duration = turn.duration + profile.properties.u_turn_penalty
    end
  end

  if profile.properties.weight_name == 'distance' then
     turn.weight = 0
  else
     turn.weight = turn.duration
  end

  if profile.properties.weight_name == 'routability' then
      if not turn.source_restricted and turn.target_restricted then
          turn.weight = constants.max_turn_weight
      end
  end
end

return {
  setup = setup,
  process_way = process_way,
  process_node = process_node,
  process_turn = process_turn
}
