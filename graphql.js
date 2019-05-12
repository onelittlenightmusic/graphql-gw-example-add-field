const { ApolloServer, gql } = require('apollo-server-lambda');
const {makeRemoteExecutableSchema, mergeSchemas, introspectSchema } = require('graphql-tools');
const fetch = require('node-fetch');
const { HttpLink } = require('apollo-link-http');
const { config } = require('dotenv');

// (Just a preparation) function for fetching Github schema
config()
const createRemoteSchema = async () => {
	const uri = 'https://api.github.com/graphql';
	const headers = { Authorization: `bearer ${process.env.GITHUB_ACCESS_TOKEN}`};
	const link = new HttpLink({uri, fetch, headers});
	return makeRemoteExecutableSchema({
		schema: await introspectSchema(link),
		link
	});
};

// New two functions (A, B) added as fields to a type "Organization" in Github schema.
// NOTE: these functions requires "Organizations.repositories.stargazers.totalCount".
// "repos" means repositories, but the name is changed because of a reason to explain later.

// Function A: get stargazer number sum of multiple repositories.
const funcA = (organization) => {
	const array = organization.repos.nodes.map(e => e.stargazers.totalCount)
	return array.reduce((a,b) => a + b)
}

// Function B: get max from stargazer numbers of multiple repositories.
const funcB = (organization) => 
  Math.max.apply(Math, organization.repos.nodes.map(e => e.stargazers.totalCount))

// New schema incluging new fields.
const createNewSchema = async () => {
	// 1. Original Github schema
	const originalSchema = await createRemoteSchema();

	// 2. Schema extension to add new field
	const schemaExtension = gql`
		extend type Organization {
			"countSum: new field for Function A (calculate sum)" # comment for Function A
			countSum: Int # Function A
			"countMax: new field for Function A (get sum)" # comment for Function B
			countMax: Int # Function B
		}
	`;

	// 3. Fragment about which field must be prefetched.
	// IMPORTANT: countSumFunc requires "stargazers.totalCount". So I must set a new fragment for prefetching required data.
	// Fragment name cannot conflict with existing field name (e.g. "repositories"). This is why the name "repos" is changed.
	const fragmentRequired = `fragment repos on Organization {
			repos: repositories(first: 20) { # some arg required. 
				nodes {
					stargazers {
						totalCount
					}
				}
		  }
		}`;

	// 4. final schema = 1. original schema + 2. schema extension (with 3. required fragment)
	const finalSchema = mergeSchemas({
		schemas:[originalSchema, schemaExtension], // 1. + 2.
		resolvers: { // resolvers for 2.
			Organization: {
				countSum: { // Function A
					resolve: (parent, args, context, info) => funcA(parent),
					fragment: fragmentRequired // 3.
				},
				countMax: { // Function B
					resolve: (parent, args, context, info) => funcB(parent),
					fragment: fragmentRequired
				}
			}
		}
	});

	return finalSchema
}

// (just a common pattern) start GraphQL server with new schema.
let handler
module.exports.graphqlHandler = async (event,context, callback) => {
    if(handler == null) {
        const server = new ApolloServer({ schema: await createNewSchema() });
		handler = server.createHandler();
	} else {
		console.log("Already initialized")
	}
    
	context.callbackWaitsForEmptyEventLoop = false;
	return new Promise((resolve, reject) => {
			handler(event, context, callback);
	});
}
