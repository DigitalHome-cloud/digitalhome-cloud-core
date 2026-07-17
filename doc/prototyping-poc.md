This document discusses the next steps to enable the first digitalhome deployment. This will be the DHC v 1.0 golive

Whilest the official version of the DHC model is v3, there is no deployment yet. So we can still be somewhat flexible and apply the latest learnings and finding
The solution is build around 8 pillqrs

1. VIEW: governance 
2. VIEW: spatial 
3. VIEW: building 
4. VIEW: electrical 
5. VIEW: plumbing 
6. VIEW: heating 
7. VIEW: network 
8. VIEW: automation 
9. VIEW: compliance

We will snow focus on the electrical installatio, knowing that there will be some overlab to build an A-Box propotype or POC
I propose to use the propotype, POC or exqmpls for the models place into the core/schema/abox folder in order to separated them 
from the Demo systems that will be use in the DCH 1.0 applications (portal, designer, operator)
This way we avoid similar confusion slike the "no data in abox rule".

# Model structure
## T-Box
The T-BOX for DHC v1.0 will be 
* Brick+extensions.ttl (Bundle from the Brick v1.5 release)
* dhc-core.ttl ( v3 work in progress)
* dhc-app-metadata.ttl (annotation for the DHC applications, to be completed once we are happy with the dhc-core.ttl)

## C-Box
The C box qre the SHACL rule sets. it is structured according to the 8 domains

1. VIEW: governance 
2. VIEW: spatial 
3. VIEW: building 
4. VIEW: electrical 
5. VIEW: plumbing 
6. VIEW: heating 
7. VIEW: network 
8. VIEW: automation 
9. VIEW: compliance

I suggest we focus on the french NF C 15-100 and NF C 14-100 first and delete the other .ttl files. Once this is sound qnd the DHC core is 
releasd, we can add other norms. This makes maintenace and updates easier during prototyping

Action 4 Claude: clean C-Box

## A-Box
As mentioned, these are the frist propotype or POC digitalHomes. The first one we just finished. 
/home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/repos/core/schema/abox/demo-home.ttl
This touches on the core feature of DHC 1.0 - designing, validation and running/maintaining electrical installation from the 
generator to the most common consumers. 
Automation comes in with the Deye power management and the Homematic measurement and smarthome features.

## The pipeline
I believe the pipeline is 

TBox(.ttl)-> [Deployment and testing toolset] -> Abox(.ttl,.jsonld) -> Simple wiring and connection diagram 
CBox.ttl  -> ??????? Please can you clarify

The tooling needs in my view an improvement and clear architecture
Clean /home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/repos/core/py-tools, only keep ontology_explorer.py and related .conf file

ontology_explorer.py is qt the moment the tool to create qnd maintain .ttl files. It is also used by the Claude skill, but more build for humans
How to improve?

Brick natively provides python modules like brick_tq_shacl, brick_model_summarizer, brickschema, brickschema_rdflib_sqlalchemy-0.6.2.dist-info.
e.g. 
/home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/experimental/dhc-modelling/py-tools/01-Generate-ABOX.py
/home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/experimental/Brick/examples/simple_apartment/generate.py

What is their reason to exists?
How to incorporate and use them in our context?

Please summarise the testing tools qnd the .ttl and .jsonld javascript capabilities and routines that are poart of the DHC solution

## Proposed next steps
1. Brainstorming and optimisation of the ABox, prototyping pipeline in the core/schema mudule
2. Complete qnd validate /home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/repos/core/schema/abox/demo-home.ttl
   3. rename it to elctrical-installation-house.ttl
4. transform /home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/experimental/Brick/examples/simple_apartment/apartment.ttl into a digitlHome appartment
   5. Only power grid, 6kw; simple classical NF C 15-100 compliant installation, no domotic
6. Incorporate Brick templates such as the below to show practical examples
   7./home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/experimental/Brick/examples

The /home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/experimental/Brick/examples has examples of the application of Brick concepts for ligning,
meters (like in the Deye mesurements) with external timeseries data, that could be adapted to show how it works in our S3 context 

In short, the core/schema/abox should have similar or same examples like /home/frankuwe/digitalhomeCloud/digitalhome-cloud-darkfactory/experimental/Brick/examples in the 
DHC context. Simple qpplicqtion to show a particulat concept end-to-end rather than full demo smarthomes. 







