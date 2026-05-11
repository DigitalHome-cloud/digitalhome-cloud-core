# Statial modeling

The Spatial modelling is based on the RealEstate Core

A Space is contiguous part of the physical world that has a 3D spatial extent and that contains or can contain sub-spaces. For example a Region can contain many Sites, which in turn can contain many Buildings, which in turn can contain Levels and Rooms. Note that we differentiate between spaces that are designed/architected (subtypes of Architecture) and spaces that are not; the former have a number of properties specific to constructed spaces.

Spatial location is described using locatedIn and isLocationOf relationships together with some Space instance.

Administrative parthood, i.e., membership in a Collection, is described using the outgoing Collection relationship includes.

Parthood is described using the hasPart and isPartOf relationships. Instances of a type can only have other instances of the same type as parts; e.g., assets can only have assets as parts, spaces can only have spaces, and so forth. This provides a simple a consistent way for developers to navigate the building topology. To jump across these topologies (e.g., to indicate that an asset has a spatial location), other specific properties are used, see below.


A BuildingElement is a part that constitutes a piece of a building’s structural makeup, for example Facade, Wall, Slab, RoofInner, etc.
An Asset is an object which is placed inside of a building, but is not an integral part of that building’s structure. We provide a hierarchy of assests, for example architectural, furniture, etc. Our Equipment asset hierarchy is sourced from our collaboration with Brick Schema.
A Point indicates the capacity of an entity, be it an Architecture, an Asset, to produce or ingest data. The Point hierarchy is sourced from our collaboration with Brick Schema. Specific subclasses specialize this behavior: Sensor entities harvest data from the real world, Command entities accept commands from a digital twin platform, and Setpoint entities configure some capability or system, etc.
Collection covers administrative groupings of entities that are adressed and treated as a unit for some purpose. These entities may have some spatial arrangement (e.g., an apartment is typically contiguous) but that is not a requirement (see, e.g., a distributed campus consisting of spatially disjoint plots or buildings).
Agent describes any basic types of stakeholder that can have roles or perform activities, and is subclassed into, e.g., people, companies, departments.
RealEstateCore employs a set of design principles for how we wire up these types, including:

