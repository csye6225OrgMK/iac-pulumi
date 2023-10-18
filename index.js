const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const vpcCIDRBlock = new pulumi.Config("db_vpc").require("cidrBlock");
const publicRouteTableCIDRBlock = new pulumi.Config("db_publicRouteTable").require("cidrBlock");
const aws_region = new pulumi.Config("aws").require("region");
const config1 = new pulumi.Config();
const keyName = new pulumi.Config("db_vpc").require('key');

// Function to get available AWS availability zones
const getAvailableAvailabilityZones = async () => {
    const zones = await aws.getAvailabilityZones({ state: "available" });
    return zones.names.slice(0, 3);
};

// Function to calculate CIDR block for subnets
const calculateSubnetCIDRBlock = (baseCIDRBlock, index) => {
    const subnetMask = 24; // Adjust the subnet mask as needed
    const baseCIDRParts = baseCIDRBlock.split("/");
    const networkAddress = baseCIDRParts[0].split(".");
    const newSubnetAddress = `${networkAddress[0]}.${networkAddress[1]}.${index}.${networkAddress[2]}`;
    return `${newSubnetAddress}/${subnetMask}`;
};

// Create Virtual Private Cloud (VPC)
const db_vpc = new aws.ec2.Vpc("db_vpc", {
    cidrBlock: vpcCIDRBlock,
    instanceTenancy: "default",
    tags: {
        Name: "db_vpc",
    },
});

// Get available availability zones
const createSubnets = async () => {
    const availabilityZones = await getAvailableAvailabilityZones();

    // Create an Internet Gateway resource and attach it to the VPC
    const db_internetGateway = new aws.ec2.InternetGateway("db_internetGateway", {
        vpcId: db_vpc.id,
        tags: {
            Name: "db_internetGateway",
        },
    });

    // Create a public route table and associate all public subnets
    const db_publicRouteTable = new aws.ec2.RouteTable("db_publicRouteTable", {
        vpcId: db_vpc.id,
        routes: [
            {
                cidrBlock: publicRouteTableCIDRBlock, // The destination CIDR block for the internet
                gatewayId: db_internetGateway.id, // The internet gateway as the target
            },
        ],
        tags: {
            Name: "db_publicRouteTable",
        },
    });

    const publicRoute = new aws.ec2.Route("publicRoute", {
        routeTableId: db_publicRouteTable.id,
        destinationCidrBlock: publicRouteTableCIDRBlock,
        gatewayId: db_internetGateway.id,
    });

    const db_publicSubnets = [];
    const db_privateSubnets = [];

    for (let i = 0; i < availabilityZones.length; i++) {
        // Calculate the CIDR block for public and private subnets
        const publicSubnetCIDRBlock = calculateSubnetCIDRBlock(vpcCIDRBlock, i + 10);
        const privateSubnetCIDRBlock = calculateSubnetCIDRBlock(vpcCIDRBlock, i + 15);

        // Create public subnet
        const publicSubnet = new aws.ec2.Subnet(`db_publicSubnet${i + 1}`, {
            vpcId: db_vpc.id,
            availabilityZone: availabilityZones[i],
            cidrBlock: publicSubnetCIDRBlock,
            mapPublicIpOnLaunch: true, // Enable auto-assign public IPv4 address
            tags: {
                Name: `db_publicSubnet${i + 1}`,
            },
        });

        db_publicSubnets.push(publicSubnet);

        // Create private subnet
        const privateSubnet = new aws.ec2.Subnet(`db_privateSubnet${i + 1}`, {
            vpcId: db_vpc.id,
            availabilityZone: availabilityZones[i],
            cidrBlock: privateSubnetCIDRBlock,
            tags: {
                Name: `db_privateSubnet${i + 1}`,
            },
        });

        db_privateSubnets.push(privateSubnet);
    }

    // Create an application security group

    const application_Security_Group = new aws.ec2.SecurityGroup("application_Security_Group", {

        description: "Application Security Group for web instances",

        vpcId: db_vpc.id,

        ingress:

            [

                        // Allow SSH (port 22) from anywhere

                        {

                            protocol: "tcp",

                            fromPort: 22,

                            toPort: 22,

                            cidrBlocks: ["0.0.0.0/0"]

                        },

                        // Allow HTTP (port 80) from anywhere

                        {

                            protocol: "tcp",

                            fromPort: 80,

                            toPort: 80,

                            cidrBlocks: ["0.0.0.0/0"]

                        },

                        // Allow HTTPS (port 443) from anywhere

                        {

                            protocol: "tcp",

                            fromPort: 443,

                            toPort: 443,

                            cidrBlocks: ["0.0.0.0/0"]

                        },

                        // Replace '<your-application-port>' with the actual port your application runs on

                        {

                            protocol: "tcp",

                            fromPort: 8080,

                            toPort: 8080,

                            cidrBlocks: ["0.0.0.0/0"]

                        },

        ],

    });

    for (let i = 0; i < db_publicSubnets.length; i++) {
        new aws.ec2.RouteTableAssociation(`db_publicRouteTableAssociation-${i}`, {
            subnetId: db_publicSubnets[i].id,
            routeTableId: db_publicRouteTable.id,
        });
    }

    // Create a private route table and associate all private subnets
    const db_privateRouteTable = new aws.ec2.RouteTable("db_privateRouteTable", {
        vpcId: db_vpc.id,
        tags: {
            Name: "db_privateRouteTable",
        },
    });

    for (let i = 0; i < db_privateSubnets.length; i++) {
        new aws.ec2.RouteTableAssociation(`db_privateRouteTableAssociation-${i}`, {
            subnetId: db_privateSubnets[i].id,
            routeTableId: db_privateRouteTable.id,
        });
    }

    // EC2 Instance
    console.log("Ec2 instance creation started..");
    const ec2Instance = new aws.ec2.Instance("ec2Instance", {
        instanceType: "t2.micro", // Set the desired instance type
        ami: "ami-0c72bc50179e283c6", // Replace with your custom AMI ID
        vpcSecurityGroupIds: [application_Security_Group.id],
        subnetId: db_publicSubnets[0].id, // Choose one of your public subnets
        vpcId: db_vpc.id,
        keyName: keyName,
        rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
        },
        tags: {
            Name: "EC2Instance",
        },
    });
};

// Invoke the function to create subnets
createSubnets();
