# iac-pulumi

# Infrastructure as Code (IaC) with Pulumi

This repository contains the Infrastructure as Code (IaC) setup for creating the necessary networking infrastructure in AWS using Pulumi.

## Prerequisites

### Install and Configure AWS Command Line Interface (CLI)

1. Install the AWS Command Line Interface (CLI) on your development machine (laptop):

    ```https://aws.amazon.com/cli/```

    ```aws version``` to check version

   ```bash```
   ```brew install awscli```

    ```aws configure --profile dev```
    ```aws configure --profile demo```


2. install pulumi

    ```brew install pulumi```

    ```pulumi version``` to check version

 

3. set the pulumi locally & configure the user account

    ```pulumi login --local```

       - select -> aws:javascript

           - create a stack with proper project name & accessKey

    ```pulumi config set aws:accessKey <AccessKey>```

    ```pulumi config set --secret  aws:secretKey <your_secret_key>```

    ```pulumi config set aws:region <region>```

 

4. modify index.js

 

5. update pulumi.dev.yaml with all the environment variables

 

6. to execute the code block

    ```pulumi up```

    and to refresh the code

    ```pulumi refresh```
