claude, please focus only on ~/digitalhomeCloud/digitalhome-cloud-darkfactory/repos/core

focus on t-box only

RealEstateCore (REC), Brick Schema, ASHRAE 223P are implemented from the Bricks 1.4.4 release and available a schema/tbox/Brick+extensions.ttl

The new version 3 will make use of REC for 
DigitalHome.Cloud architecture, these three standards form a "stack" that moves from the human/spatial level down to the physics of the equipment.
1. RealEstateCore (REC) — The "Top-Level" Container
Role: Spatial & Administrative Context.
Focus: Where is it? Who owns it? What is it called?
DHC Usage: You use REC to define the Buildings, Apartments, Rooms, and People. It provides the primary navigation for your Designer (e.g., "Ground Floor" > "Living Room").
Key Concept: The "Bucket" for everything else.
2. Brick Schema — The "Functional" Layer
Role: Equipment & Points.
Focus: What does the device do? What data does it provide?
DHC Usage: You use Brick to classify hardware. A device isn't just a "box"; it’s a brick:Air_Temperature_Sensor or a brick:Light_Fixture. It handles the relationships between sensors and the spaces they monitor (e.g., Sensor is located in Room).
Key Concept: The "Digital Twin" of the device and its telemetry.
3. ASHRAE 223P — The "Physics" Layer
Role: Semantic Modeling of Connectivity.
Focus: How are things physically connected? What flows through them?
DHC Usage: While Brick says "There is a battery," ASHRAE 223P defines the Topology. It models the specific ports and connections (Electrical, Hydronic, Air) to ensure the system understands that Battery A is connected to Inverter B via a specific Electrical Connection.
Key Concept: The "Blueprint" of flows (Energy, Water, Air).
----------------------------------------------------------------
1. DHC Core (dhc-core.ttl)
Role: Domain Extension & Gap Filling.
The "What": This is where you define new Classes and Properties that don't exist in Brick, REC, or 223P but are essential for the "Digital Home" domain.
Key Tasks:
Filling Gaps: Defining residential-specific classes like dhc:MaisonDeMaitre or dhc:TinyHouse.
Defining Logic: Creating custom Data Properties (e.g., dhc:isPrimaryResidence) that your system needs to store.
Hierarchy: Mapping how your custom classes inherit from standard ones (e.g., dhc:RowHouse rdfs:subClassOf rec:Building).
Analogy: If Brick/REC/223P are the dictionary, DHC Core is the specialized terminology for your specific industry.
2. DHC App Data (dhc-app-metadata.ttl)
Role: UI/UX Configuration & Feature Flagging.
The "How": This file doesn't define the meaning of things; it defines how things look and behave in your specific app.
Key Tasks:
Whitelisting: Deciding which of the thousands of Brick/REC classes actually show up in your Designer toolbox.
Categorization: Assigning classes to dhc:designView tabs (e.g., "Electrical" vs "Spatial").
UI Hints: Specifying Blockly field types (dropdown vs checkbox), default values, and localized labels for the end-user.
Internationalization: Providing the translations (@de, @fr) that the original standards often lack.
Analogy: This is the CSS and Configuration for your ontology—it skins the data for the human user.
Why separate them?
By keeping Core separate from App Data, you ensure that if you ever want to build a second app (e.g., a mobile dashboard instead of a desktop designer), you can reuse the Core logic but swap in a different App Data file for a different UI.

The structure of the dhc-core.ttl and dhc-app-metadata.ttl must have the same structure


# ============================================================
# Design views (for the SmartHome Designer toolbox):
#   - Governance: rec:Agent, roles, role assignments, projects
#   - Spatial:    DigitalHome → Area / rec:Level / rec:Room
#   - Building:   Walls, windows, doors, roof, insulation
#   - Electrical: Circuits, distribution boards, protection
#   - Plumbing:   Water supply, drainage, fixtures
#   - Heating:    HVAC, radiators, heat pumps, thermostats
#   - Network:    LAN, WiFi, ZigBee, automation protocols
#   - Automation: Groups, scenarios, sensors, actors
#   - Compliance: Norms and governed-by relationships (v2.0.0+)
# ============================================================

The dhc-core.ttl will only contain the dhc: classes and subclasses that extend the RealEstateCore (REC), Brick Schema, ASHRAE 223P 
where needed. it also contains the dcc class related object and data properties.

The dhc-app-metadata.ttl will have the annotation properties for all, DHC and Brick, REC, or 223P classes
It is the subset that is used by the DHC and provides app related annotation like Blockly representation etc.

The py-tools/ontology_explorer.py allows browsing trough the structurs. At the moment, dhc-core.ttl and dhc-app-metadata.ttl
are both work in progress and thus placed in the drafts folder.

To-Does
- create the inital clean structured cand dhc-app-metadata.ttl files in tbox folder, no content yet
  - Extend the py-tools/ontology_explorer.py to generate the tbox dhc-core.ttl and dhc-app-metadata.ttl files from any input in the drafts folder
    - The explorer currently works at class level, and keeps the active class in the conf file 
        Loaded Brick+extensions.ttl
        Loaded dhc-core.ttl
        Loaded dhc-app-metadata.ttl
    
        79,404 triples, 1,615 classes
    
    ──────────────────────────────────────────────────────
      Class (last: rec:SubBuilding, ?=search, q=quit): 
    
      rec:SubBuilding — Outbuilding
      A secondary structure on the property, separate from the main building. May have its own rooms, electrical circuits, and plumbing. Extends rec:SubBuilding.
      Parents: rec:Architecture
      Subclasses: 6 direct, 6 total | Own properties: 1
      Direction  [1] down  [2] up  [3] properties  (default=1): 
  - It should first read the tbox, and then the drafts *.ttl files. 
  - If should have an additional option 4 to update tbox, where updates are loaded from drafts 
    - for DHC classes; it would 
      - move the class, object property and data properties to the dhc-core.ttl file (move means clean from the drafts file)
      - move the annotations to dhc-app-metadata.ttl
    - for non DHC classes
      - prompt what annotations to be added from the availabme qnnotation properties
      - create the annotations in dhc-app-metadata.ttl 
    - If should have an additional option to delete dhc classes from the tbox, including data, object and annotation properties accross the dhc*.ttl files

The Brick+extensions.ttl will only be read, never modified