# iac-pulumi

# Infrastructure as Code (IaC) with Pulumi

This repository contains Infrastructure as Code (IaC) setup for creating necessary networking infrastructure in AWS using Pulumi. Additionally, it creates resources in Google Cloud Platform (GCP) for a comprehensive setup.

## Prerequisites

### Install AWS CLI and Pulumi

Ensure AWS CLI and Pulumi are installed on your machine. Follow these steps:

1. Install the [AWS CLI](https://aws.amazon.com/cli/) and configure profiles for `dev` and `demo`.

2. Install [Pulumi](https://www.pulumi.com/docs/get-started/install/).
   
3. Install the AWS Command Line Interface (CLI) on your development machine (laptop):

    ```https://aws.amazon.com/cli/```

    ```aws version``` to check version

   ```bash```
   ```brew install awscli```

    ```aws configure --profile dev```
    ```aws configure --profile demo```


4. install pulumi

    ```brew install pulumi```

    ```pulumi version``` to check version

 

5. set the pulumi locally & configure the user account

    ```pulumi login --local```

       - select -> aws:javascript

           - create a stack with proper project name & accessKey

    ```pulumi config set aws:accessKey <AccessKey>```

    ```pulumi config set --secret  aws:secretKey <your_secret_key>```

    ```pulumi config set aws:region <region>```

 

## Getting Started

Follow these steps to set up and execute the code:

1. **Modify Configuration:**
   Update `index.js` and `pulumi.dev.yaml`, `pulumi.demo.yaml` with your specific environment variables and configurations.

2. **Execute the Code:**
   Run `pulumi up` to deploy the infrastructure. Use `pulumi refresh` to update the code.

## Import SSL Certificate into AWS ACM

To import an SSL certificate into AWS ACM, use the provided command in the README.

## Code Overview

The provided code in `index.js` demonstrates:

AWS resources creation in `createAWSResources()` function, including:
- Creating a Virtual Private Cloud (VPC) in AWS.
- Setting up Amazon SNS and related AWS resources.
- Creating security groups and subnets.
- Configuration of Amazon RDS (Relational Database Service) instances.
- Auto Scaling configurations for web application instances.
- Setup of AWS Application Load Balancer (ALB).
- Integration of Route53 for DNS record configuration.

Additionally, GCP resources are provisioned in `createGCPResources()` function, including:

- Google Cloud Storage bucket.
- Google IAM service account and its permissions.
- Lambda function setup to interact with GCP services.

Feel free to explore the code for detailed implementation.

## Important Notes

- Ensure proper permissions and access keys are set before deploying resources.
- Review IAM roles and policies for security and compliance.
- Update and test your configurations in a safe environment before deploying to production.


## Import SSL Certificate into AWS ACM
To import SSL certificate into AWS ACM, use the following command:

```aws acm import-certificate --certificate fileb:/path/to/demo.talentofpainting.info.crt --private-key fileb:/path/to/demo.talentofpainting.info_key.txt --certificate-chain fileb:/path/to/demo.talentofpainting.info.ca-bundle```
