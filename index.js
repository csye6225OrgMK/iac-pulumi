
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp");
const vpcCIDRBlock = new pulumi.Config("db_vpc").require("cidrBlock");
const publicRouteTableCIDRBlock = new pulumi.Config("db_publicRouteTable").require("cidrBlock");
const aws_region = new pulumi.Config("aws").require("region");
const keyName = new pulumi.Config("db_vpc").require('key');
const amiId = new pulumi.Config("ami").require("amiId");
const userProfile = new pulumi.Config("aws").require("profile");
const zoneId = new pulumi.Config("route53").require("zoneId");
const domainName = new pulumi.Config("route53").require("domainName");
const ttl = new pulumi.Config("route53").require("ttl");

// Function to get available AWS availability zones
const getAvailableAvailabilityZones = async () => {
    const zones = await aws.getAvailabilityZones({
        state: "available"
    });
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

// Amazon SNS starts here ...
const snsTopic = new aws.sns.Topic("AssignmentSubmission", {
    displayName: "Assignment Submission",
    tags: {
        Name: "Assignment Submission",
        Environment: "Production",
    },
});

//Function to create AWS resources
const createAWSResources = async () => {
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
        routes: [{
            cidrBlock: publicRouteTableCIDRBlock, // The destination CIDR block for the internet
            gatewayId: db_internetGateway.id, // The internet gateway as the target
        }, ],
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
            mapPublicIpOnLaunch: true, // Enabling auto-assign public IPv4 address
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
    // Create a security group for the load balancer
    const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup("loadBalancerSecurityGroup", {
        vpcId: db_vpc.id,
        ingress: [{
                protocol: "tcp",
                fromPort: 80,
                toPort: 80,
                cidrBlocks: ["0.0.0.0/0"]
            },
            {
                protocol: "tcp",
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ["0.0.0.0/0"]
            },
        ],
        tags: {
            Name: "LoadBalancerSecurityGroup"
        },
    });
    // Create an application security group
    const application_Security_Group = new aws.ec2.SecurityGroup("application_Security_Group", {
        description: "Application Security Group for web instances",
        vpcId: db_vpc.id,
        ingress: [
            // Allow SSH (port 22) only from the Load Balancer Security Group
            {
                protocol: "tcp",
                fromPort: 22,
                toPort: 22,
                // securityGroups: [loadBalancerSecurityGroup.id],
                cidrBlocks: ["0.0.0.0/0"]
            },
            {
                protocol: "tcp",
                fromPort: 8080,
                toPort: 8080,
                securityGroups: [loadBalancerSecurityGroup.id],
            },
        ],
        egress: [{
            protocol: "-1", // -1 means all protocols are allowed
            fromPort: 0,
            toPort: 0, // Setting both fromPort and toPort to 0 to allow all ports
            cidrBlocks: ["0.0.0.0/0"],
        }, ],
        tags: {
            Name: "SecurityGroupWebapp",
        },
    });
    let myloadbalancerEgressRule = new aws.ec2.SecurityGroupRule("myloadbalancerEgressRule", {
        type: "egress",
        securityGroupId: loadBalancerSecurityGroup.id,
        protocol: "tcp",
        fromPort: 8080,
        toPort: 8080,
        sourceSecurityGroupId: application_Security_Group.id
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

    // ----------  RDS configuration starts here ...

    // Create a security group for RDS instances
    const databaseSecurityGroup = new aws.ec2.SecurityGroup("databaseSecurityGroup", {
        vpcId: db_vpc.id,
        ingress: [
            // Adding ingress rule for your application port
            {
                fromPort: 3306,
                toPort: 3306,
                protocol: "tcp",
                securityGroups: [application_Security_Group.id],
            },
        ],
        egress: [
            // Adding egress rule for your application port
            {
                fromPort: 3306,
                toPort: 3306,
                protocol: "tcp",
                securityGroups: [application_Security_Group.id],
            },
        ]
    });
    await databaseSecurityGroup.id;

    // Create an RDS parameter group
    const rdsParameterGroup = new aws.rds.ParameterGroup("myRdsParameterGroup", {
        vpcId: db_vpc.id,
        family: "mysql8.0",
        name: "my-rds-parameter-group",
        parameters: [{
                name: "character_set_server",
                value: "utf8",
            },
            {
                name: "collation_server",
                value: "utf8_general_ci",
            },
        ],
        tags: {
            Name: "myRdsParameterGroup",
        },
    });


    const rdsSubnetGroup = new aws.rds.SubnetGroup("rds_subnet_group", {
        subnetIds: db_privateSubnets.map(subnet => subnet.id),
        tags: {
            Name: "rds_subnet_group",
        },
    });

    //RDS instance creation starts here...
    const rdsInstance = new aws.rds.Instance("rds-instance", {
        allocatedStorage: 20,
        storageType: "gp2",
        multiAz: false,
        parameterGroupName: rdsParameterGroup.name,
        identifier: "csye6225",
        engine: "mysql",
        instanceClass: "db.t2.micro",
        username: "root",
        password: "root#123",
        skipFinalSnapshot: true, // To avoid taking a final snapshot when deleting the RDS instance
        publiclyAccessible: false, // Ensuring it's not publicly accessible
        dbSubnetGroupName: rdsSubnetGroup.name,
        vpcSecurityGroupIds: [databaseSecurityGroup.id], //ec2Instance.id.vpcSecurityGroupIds --> this does not attach the databseSecurityGroup, // Attach the security group
        dbName: "csye6225", // Database name
        tags: {
            Name: "rds-db-instance",
        },
    });


    // user database configuration starts here ...
    const DB_HOST = pulumi.interpolate`${rdsInstance.address}`;
    // User data script to configure the EC2 instance
    const userData = pulumi.interpolate`#!/bin/bash
    # Define the path to the .env file
    envFile="/opt/csye6225/madhura_kurhadkar_002769373_06/.env"
    
    # Check if the .env file exists
    if [ -e "$envFile" ]; then
      # If it exists, remove it
      sudo rm "$envFile"
    fi
    
    # Create the .env file
    sudo touch "$envFile"
    echo "DB_NAME='${rdsInstance.dbName}'" | sudo tee -a "$envFile"
    echo "DB_HOST='${DB_HOST}'" | sudo tee -a "$envFile"
    echo "DB_USERNAME='${rdsInstance.username}'" | sudo tee -a "$envFile"
    echo "DB_PASSWORD='${rdsInstance.password}'" | sudo tee -a "$envFile"
    echo "PORT='3306'" | sudo tee -a "$envFile"
    echo "SNS_TOPIC_ARN='${snsTopic.arn}'" | sudo tee -a "$envFile"
    echo "profile='${userProfile}'" | sudo tee -a "$envFile"
    sudo chown -R csye6225:csye6225 "$envFile"
    #sudo chmod -R 755 "$envFile"
    # Start the CloudWatch Agent and enable it to start on boot, below line is working line
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/csye6225/madhura_kurhadkar_002769373_06/amazon-cloudwatch-agent.json
    
    #sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
    sudo systemctl enable amazon-cloudwatch-agent
    sudo systemctl start amazon-cloudwatch-agent`;
    
    const userDataBase64 = pulumi.output(userData).apply(userData => Buffer.from(userData).toString('base64'));
    // Create IAM Role for CloudWatch Agent
    const ec2CloudWatch = new aws.iam.Role("ec2CloudWatch", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ec2.amazonaws.com",
                },
            }],
        }),
    });

    // Attach AmazonCloudWatchAgentServerPolicy to the IAM role
    const cloudWatchAgentPolicyAttachment = new aws.iam.RolePolicyAttachment("CloudWatchAgentPolicyAttachment", {
        role: ec2CloudWatch,
        policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
    });

    // Attach a policy granting full access to SNS
    const snsFullAccessPolicy = new aws.iam.Policy("SNSFullAccessPolicy", {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: "sns:*",
                Resource: "*",
            }],
        }),
    });

    // Attach the SNS policy to the EC2 role
    const snsPolicyAttachment = new aws.iam.RolePolicyAttachment("SNSPolicyAttachment", {
        policyArn: snsFullAccessPolicy.arn,
        role: ec2CloudWatch.name,
    });

    // Attach a policy granting full access to DynamoDB
    const dynamoDBFullAccessPolicy = new aws.iam.Policy("DynamoDBFullAccessPolicy", {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: "dynamodb:*",
                Resource: "*",
            }],
        }),
    });

    // Attach the DynamoDB policy to the EC2 role
    const dynamoDBPolicyAttachment = new aws.iam.RolePolicyAttachment("DynamoDBPolicyAttachment", {
        policyArn: dynamoDBFullAccessPolicy.arn,
        role: ec2CloudWatch.name,
    });


    let instanceProfile = new aws.iam.InstanceProfile("myInstanceProfile", {
        role: ec2CloudWatch.name
    });

    // AutoScaling Code starts here...

    // Launch Template for Auto Scaling Group
    const webAppLaunchTemplate = new aws.ec2.LaunchTemplate("webAppLaunchTemplate", {
        vpcId: db_vpc.id,
        securityGroups: [application_Security_Group.id],
        vpcSecurityGroupIds: [application_Security_Group.id],
        imageId: amiId,
        version:"$Latest",
        instanceType: "t2.micro",
        keyName: keyName,
        userData: userDataBase64,
        iamInstanceProfile: {name: instanceProfile.name},
        associatePublicIpAddress: false,
        rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
            deleteOnTermination: true,
        },
        tags: {
            Name: "webAppLaunchTemplate",
        },
    });
    // Create a target group for the ALB
    const webAppTargetGroup = new aws.lb.TargetGroup("webAppTargetGroup", {
        port: 8080, //Application port goes here
        protocol: "HTTP",
        targetType: "instance",
        vpcId: db_vpc.id,
        healthCheck: {
            path: "/healthz",
            port: 8080,
            protocol: "HTTP",
            interval: 30,
            timeout: 10,
            unhealthyThreshold: 2,
            healthyThreshold: 2,
        },
    });
    // Auto Scaling Group
    const autoScalingGroup = new aws.autoscaling.Group("webAppAutoScalingGroup", {
        vpcZoneIdentifiers: db_publicSubnets.map(s => s.id),
        healthCheckType: "EC2",
        desiredCapacity: 1,
        version: "$Latest",
        maxSize: 3,
        minSize: 1,
        cooldown: 60,
        iamInstanceProfile: {id: instanceProfile.id, version: "$Latest",},
        waitForCapacityTimeout: "0",
        protectFromScaleIn: false,
        launchTemplate: {
            id: webAppLaunchTemplate.id,
            version:'$Latest'
          },
          tagSpecifications: [
            {
              resourceType: "instance",
              tags: [
                {
                  key: "Name",
                  value: "WebAppInstance"
                }
              ]  
            }
          ],
          targetGroupArns: [webAppTargetGroup.arn],
          instanceRefresh: {
              strategy: "Rolling",
              preferences: {
                  minHealthyPercentage: 90,
                  instanceWarmup: 60,
              },
          },
          forceDelete: true
    });
    // Auto Scaling Policies
    const scaleUpPolicy = new aws.autoscaling.Policy("webappScaleUpPolicy", {
        scalingAdjustment: 1,
        cooldown: 60,
        adjustmentType: "ChangeInCapacity",
        autoscalingGroupName: autoScalingGroup.name,
        policyType: 'SimpleScaling',
    });
    const scaleDownPolicy = new aws.autoscaling.Policy("webappScaleDownPolicy", {
        scalingAdjustment: -1,
        cooldown: 60,
        adjustmentType: "ChangeInCapacity",
        autoscalingGroupName: autoScalingGroup.name,
        policyType: 'SimpleScaling',
    });
    // CloudWatch Alarm for CPU Usage
    const cpuAlarmHigh = new aws.cloudwatch.MetricAlarm("webAppCPUAlarmHigh", {
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        evaluationPeriods: 2,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 5,
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
        alarmActions: [scaleUpPolicy.arn],
        insufficientDataActions: [],
    });

    // CloudWatch Alarm for CPU Usage
    const cpuAlarmLow = new aws.cloudwatch.MetricAlarm("webAppCPUAlarmLow", {
        comparisonOperator: "LessThanOrEqualToThreshold",
        evaluationPeriods: 2,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 3,
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
        alarmActions: [scaleDownPolicy.arn],
        insufficientDataActions: [],
    });


    // Create an Application Load Balancer (ALB)
    const webAppLoadBalancer = new aws.lb.LoadBalancer("webAppLoadBalancer", {
    securityGroups: [loadBalancerSecurityGroup.id],
    subnets: db_publicSubnets.map(subnet => subnet.id),
    enableDeletionProtection: false,
    });

    const certificate = await aws.acm.getCertificate({
        domain: domainName,
        mostRecent: true,
        statuses: ["ISSUED"],
    });
 
    const certificateArn = pulumi.interpolate`${certificate.arn}`;
    // Create a listener for the ALB
    const webAppListener = new aws.lb.Listener("webAppListener", {
        loadBalancerArn: webAppLoadBalancer.arn,
        // port: 80,
        port: 443,
        protocol: "HTTPS",
        defaultActions: [{
            type: "forward",
            targetGroupArn: webAppTargetGroup.arn
        }],
        sslPolicy: "ELBSecurityPolicy-2016-08",
        certificateArn: certificateArn,
    });
    // Create a Route53 record to point to the EC2 instance's public IP address

    const record = new aws.route53.Record("ec2InstanceRecord", {
        zoneId: zoneId, 
        name: domainName,
        type: "A",
        aliases: [
            {
                name: webAppLoadBalancer.dnsName,
                zoneId: webAppLoadBalancer.zoneId,
                evaluateTargetHealth: true,
            },
        ],
        // ttl: ttl,
        allowOverwrite: true,
    });
};


//Function to create GCP resources
const createGCPResources = async () => {
    
    const mailgunDomain = new pulumi.Config("mailgun").require("domain");
    const mailgunapikey = new pulumi.Config("mailgun").require("apikey");
    const dynamoDBTable = new aws.dynamodb.Table("AssignmentSubmissionDynamoDBTable", {
        attributes: [
            {
                name: "emailId",
                type: "S", 
            },
            {
                name: "sentAt",
                type: "S", 
            },
            {
                name: "Status",
                type: "S",
            },
        ],
        billingMode: "PAY_PER_REQUEST", 
        hashKey: "emailId", 
        globalSecondaryIndexes: [
            {
                name: "sentAtIndex",
                hashKey: "sentAt",
                projectionType: "INCLUDE",
                nonKeyAttributes: ["Status"],   
            },
            {
                name: "StatusIndex",
                hashKey: "Status",
                projectionType: "INCLUDE",
                nonKeyAttributes: ["sentAt"],   
            },
        ],
        tags: {
            Name: "AssignmentSubmissionDynamoDBTable", 
        },
    });

    const bucket = new gcp.storage.Bucket("assignment-submission-bucket", {
        location: "US",
        forceDestroy: true,
        versioning: {
            enabled: true,
        },
    }, 
    );

    // Create Google Service Account
    const serviceAccount = new gcp.serviceaccount.Account("AssignmentSubmissionServiceAccount", {
        accountId: "assignment-submission-sa",
    });

    // Create Access Keys for the Google Service Account
    const accessKeys = new gcp.serviceaccount.Key("AssignmentSubmissionServiceAccountAccessKeys", {
        serviceAccountId: serviceAccount.name,
        publicKeyType: "TYPE_X509_PEM_FILE",            // for generating public key specifically in .pem format
    });

    const snsFullAccessPolicyLambda = new aws.iam.Policy("snsFullAccessPolicyLambda", {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: "sns:*",
                Resource: "*",
            }],
        }),
    });
    
    const dynamoDBFullAccessPolicyLambda = new aws.iam.Policy("dynamoDBFullAccessPolicyLambda", {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: "dynamodb:*",
                Resource: "*",
            }],
        }),
    });

    const cloudWatchLogsPolicyLambda = new aws.iam.Policy("cloudWatchLogsPolicyLambda", {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                    Effect: "Allow",
                    Action: [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    Resource: "arn:aws:logs:*:*:*"
                },
                {
                    Effect: "Allow",
                    Action: "logs:DescribeLogGroups",
                    Resource: "*"
                }
            ],
        }),
    });

    const lambdaRole = new aws.iam.Role("AssignmentSubmissionLambdaRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "lambda.amazonaws.com",
                },
            }],
        }),
    });
    
    // Attach SNS Full Access policy
    const snsFullAccessPolicyAttachment = new aws.iam.RolePolicyAttachment("SNSFullAccessPolicyAttachment", {
        role: lambdaRole,
        policyArn: snsFullAccessPolicyLambda.arn, 
    });
    
    // Attach DynamoDB Full Access policy
    const dynamoDBFullAccessPolicyAttachment = new aws.iam.RolePolicyAttachment("DynamoDBFullAccessPolicyAttachment", {
        role: lambdaRole,
        policyArn: dynamoDBFullAccessPolicyLambda.arn, 
    });
    
    // Attach CloudWatch Logs policy
    const cloudWatchLogsPolicyAttachment = new aws.iam.RolePolicyAttachment("CloudWatchLogsPolicyAttachment", {
        role: lambdaRole,
        policyArn: cloudWatchLogsPolicyLambda.arn,
    });
    
    const GCP_PROJECT_ID = new pulumi.Config("gcp").require("project");

    // Give the service account the required permissions
    const gcpBucketAdminBinding = new gcp.projects.IAMBinding("gcpBucketAdminBinding", {
        members: [
            pulumi.interpolate`serviceAccount:${serviceAccount.email}`, 
        ],
        role: "roles/storage.admin",
        project: GCP_PROJECT_ID,
    });
    const workloadIdentityUser = new gcp.projects.IAMMember("workloadIdentityUser", {
        project: GCP_PROJECT_ID,
        role: "roles/iam.workloadIdentityUser",
        member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
        serviceAccountId: serviceAccount.accountId,
    });

    // Create Lambda Function
    const lambdaFunction = new aws.lambda.Function("AssignmentSubmissionLambdaFunction", {
        code: new pulumi.asset.AssetArchive({
            ".": new pulumi.asset.FileArchive("../Archive.zip"),
        }),
        handler: "index.handler",
        role: lambdaRole.arn,
        runtime: "nodejs18.x",
        environment: {
            variables: {
                "GCP_SERVICE_ACCOUNT_KEY": accessKeys.privateKey,
                "GCP_PROJECT_ID": GCP_PROJECT_ID,
                "GOOGLE_STORAGE_BUCKET_URL": bucket.url,
                "GOOGLE_STORAGE_BUCKET_NAME": bucket.name,
                "DYNAMODB_TABLE_NAME": dynamoDBTable.name,
                "MAILGUN_API_KEY": mailgunapikey,
                "DOMAIN": mailgunDomain,
            }
        },
        timeoutSeconds: 60,
        tracingConfig: {
            mode: "Active",
        },
    });
    const snsSubscription = new aws.sns.TopicSubscription(`SNSSubscription`, {
        topic: snsTopic.arn,
        role:lambdaRole.arn,
        protocol: "lambda",
        endpoint: lambdaFunction.arn,
    });

    // Ensure Lambda function can invoke SNS
    const lambdaPermission = new aws.lambda.Permission("lambdaSNSPermission", {
        action: "lambda:InvokeFunction",
        function: lambdaFunction.arn,
        principal: "sns.amazonaws.com",
        sourceArn: snsTopic.arn,
        role:lambdaRole.arn,
    });
};

createAWSResources();
createGCPResources();


